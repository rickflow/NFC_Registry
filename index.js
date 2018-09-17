const fs = require('fs')
const http = require('http')
const sqlite3 = require('sqlite3')
const Path = require("path")

const ANFC = require('./ArduinoNFC.js')
const config = require('./config.json')

let db
let isRealTimeOn = false
let currentHistory = {}
let currentRes = null
let screenRes = null

const MIME = {
	"js" :"application/javascript",
	"html" :"text/html",
	"svg" :"image/svg+xml",
	"json" :"application/json"
}

const serveMedia = (e, public_path)=>{
	return new Promise(resolve =>{
		if(e.req.url.includes(".."))
			throw "Invalid \"..\""
		let local_path = Path.join(public_path, (e.req.url == "/")? "/index.html" : e.req.url)
		
		let mime = MIME[Path.extname(local_path)]
		if(mime !=null)
			e.res.setHeader('Content-Type', mime)
		
		fs.createReadStream(local_path).pipe(e.res)
		e.res.once("finish", ()=>{
			e.res.end()
		})
		
	})
}

const getDateFromDatetime = str =>{
	let match = str.match(/\d+-\d+-\d+/)
	if(match == null) return null
	return match[0]
}

const readReqBody = (req)=>{
	return new Promise(resolve=>{
		let data = ''
		req.on('data', chunk=>{
			data+= chunk
		})
		req.on('end',()=>{
			resolve(data)
		})
	})
}

const onTag = (err,data) =>{
	if(data != null){
		let d = new Date()
		let success
		let inDB = false
		if(data in currentHistory){
			success = false
			inDB = true
		}
		else success = AddToCurrentHistory(data, d.toLocaleString())
		if (success){
			db.run("INSERT INTO history VALUES(?, ?)", [data, d.toLocaleString()], (err)=>{
				if(err) throw err
				if(currentRes != null)
					currentRes.write(`id: ${(new Date()).toLocaleString()+'\n'}data: ${data+'\n\n'}`)
				if(screenRes !== null)
					screenRes.write(`data: success${'\n\n'}`)
				console.log(data)
				
			})
		}
		else{
			if(screenRes !== null && inDB == false){
				screenRes.write(`data: fail${'\n\n'}`)
				console.log("FAIL")
			}
			else{
				screenRes.write(`data: already${'\n\n'}`)
				console.log("ALREADY")
			}
		}
	}
		
}

const endpoints = {
	"/tag|POST": async e=>{
		let data = await readReqBody(e.req)
		data = JSON.parse(data)
		let response = {}
		try{
			if(data.action == "read")
				response.data = await nfc.read()
			else if (data.action == "write" && data.data != null){
				while(data.data[0] == config.cmdchar ){
					data.data = data.data.substr(1)
				}
				if(data.data == ""){
					response.success = false
					response.data = "ERROR!"
					response = JSON.stringify(response)	
					e.res.writeHead(200,{
						'Content-Type':'application/json'
					})
					e.res.end(response)
				}else{
					
					await nfc.write(data.data).catch(err=>{throw err})
				}
			}
			else
				throw "No Action"
			
			response.success = true
		}
		catch(err){
			if(err == "TIMEOUT!" || err == "ERROR!"){
				response.success = false
				response.data = err
			}
			else{
				e.res.statusCode = 400
				e.res.end()
				return
			}
		}
		response = JSON.stringify(response)	
		e.res.writeHead(200,{
			'Content-Type':'application/json'
		})
		e.res.end(response)
	},
	"/auto|POST": async e=>{
		let data = await readReqBody(e.req)
		data = JSON.parse(data)
		let response = {}
		if(data.action == "enable"){
			await nfc.realTimeReadOn(onTag)
			isRealTimeOn = true
		}
		else if (data.action == "disable"){
			await nfc.realTimeReadOff()
			isRealTimeOn = false
		}
		else
			throw 'No Action'
		e.res.end()
	},
	"/auto|GET": e=>{
		e.res.end(isRealTimeOn+"")
	},
	"/db|POST": async e=>{
		//PROPS: action, data(id, name)
		//ACTIONS: set(insert OR update) delete 
		let data = await readReqBody(e.req)
		data = JSON.parse(data)
		if(data.id == null )
			throw "No ID!"
		
		let callback = (err)=>{
			if(err) throw err
			else{
				e.res.statusCode = 200
				e.res.end()
			}
		}
		
		if(data.action == "set" && data.name != null){
			db.run("REPLACE INTO registry VALUES(?, ?)", [data.id, data.name], callback)
		}
		else if(data.action == "delete")
			db.run("DELETE FROM registry WHERE id = ?", [data.id], callback)
		else
			throw "Invalid action"
	},
	"/db|GET": e=>{
		db.all("SELECT * FROM registry", (err,data)=>{
			if(err)throw err
			else
				e.res.end(JSON.stringify({data}))
		})
	},
	"/liveRegistry|GET": e=>{
		if (e.req.headers.accept != 'text/event-stream'){
			e.res.statusCode = 404
			e.res.end()
		}
		e.res.writeHead(200, {
			'Content-Type': 'text/event-stream',
			//'Cache-Control': 'no-cache',
			'Cache-Control': 'no-transform', // while using react proxy
			'Connection': 'keep-alive'
		})
		//e.res.write(`retry: 8000${'\n'}id: ${(new Date()).toLocaleString()+'\n'}data: begin!${'\n\n'}`)
		e.res.write(`retry: 8000${'\n\n'}`)
		
		e.res.once('close', ()=>{
			console.log("Connection closed")
		})
		currentRes = e.res
	},
	"/history|POST": async e=>{
		let data = await readReqBody(e.req)
		data = JSON.parse(data)
		let response = {data: []}
		
		if(data.action == "current"){
			for(let id in currentHistory){
				response.data.push({id, reg_date: currentHistory[id]})
			}
			
		}
		else if(data.action == "list"){
			let list = await new Promise((resolve, reject)=>{
				db.all("SELECT reg_date FROM history", (err,data)=>{
					if(err) throw err
					resolve(data)
				})
			})
			
			list.forEach(el=>{
				let date = getDateFromDatetime(el.reg_date)
				if(date !== null && !response.data.includes(date) ){
					response.data.push(date)
				}
			})
		}
		else if(data.action == "from_date"){
			if(data.date == null)
				throw "Missing date"
			let list = await new Promise((resolve, reject)=>{
				db.all("SELECT * FROM history", (err,data)=>{
					if(err) throw err
					resolve(data)
				})
			})
			
			list.forEach(el=>{
				if(getDateFromDatetime(el.reg_date) == data.date)
					response.data.push(el)
			})
		}
		else
			throw "No action defined"
		e.res.end(JSON.stringify(response))
	}
}

const loadDBHisotry = ()=>{
	return new Promise(resolve=>{
		db.all("SELECT * FROM history", (err,data)=>{
			if(err) throw err
			else
				data.forEach((el=>{
					AddToCurrentHistory(el.id, el.reg_date)
					
				}))
			resolve()
		})
	})
}

const AddToCurrentHistory = (id, date)=>{
	try{
		let day = date.match(/\d+-\d+-(\d+)/)[1]
		let now = new Date()
		if(day == now.toLocaleString().match(/\d+-\d+-(\d+)/)[1]){
			currentHistory[id] = date
			return true
		}
	}catch(err){
		return false
	}
	return false
}

let dbsetup = new Promise((resolve, reject)=>{
	let sqltables = fs.readFileSync('tables.sql').toString()
	db = new sqlite3.Database('database.db', sqlite3.OPEN_READWRITE,(err)=>{
		if(err){
			if(err.code == 'SQLITE_CANTOPEN')
				db = new sqlite3.Database('database.db',(err)=>{
					if(err) throw err
					else{
						db.exec(sqltables, (err=>{
							if(err)throw err
							else
								resolve("DB CREATED")
						}))
					}
				})
			else
				throw err
		}
		else
			resolve("DB OPENED")
	})
})

let nfc = new ANFC()
let init = async ()=>{
	let db_msg = await dbsetup
	console.log(db_msg)
	await loadDBHisotry()
	await nfc.open()
	console.log("Arduino Ready!")

	server.listen(config.server, ()=>{
		console.log("Server running")
		console.log(config.server)
	})
	
	displayServer.listen("8899", ()=>{
		console.log("Display server running")
	})

}

let server = http.createServer( async (req,res)=>{
	let endpoint = endpoints[`${req.url}|${req.method}`]
	if(endpoint != null){
		try{
			await endpoint({req,res})
		}
		catch(err){
			console.log("ERROR CATCHED")
			console.log(err)
			res.statusCode = 400
			res.end()
		}
	}
	else{
		let success = await serveMedia({req,res}, config["public_folder"])
		if(!success){
			res.statusCode = 404
			res.end()
		}
		
	}
})

const displayServer = http.createServer( (req,res)=>{
	if(req.url == "/api/"){
		if (req.headers.accept != 'text/event-stream'){
			res.statusCode = 404
			res.end()
		}
		else{
			screenRes = res
			console.log(req.url)
			res.writeHead(200, {
				'Content-Type': 'text/event-stream',
				//'Cache-Control': 'no-cache',
				'Cache-Control': 'no-transform', // while using react proxy
				'Connection': 'keep-alive'
			})
			res.write(`retry: 1000${'\n\n'}`)
			res.once('close', ()=>{
				console.log("Connection closed")
			})
		}

	}
	else if (req.url == "/"){
		res.setHeader('Content-Type', MIME["html"])
		fs.createReadStream("display.html").pipe(res)
		res.once("finish", ()=>{
			res.end()
		})
	}
	else{
		res.statusCode = 400
		res.end()
	}
})

init()