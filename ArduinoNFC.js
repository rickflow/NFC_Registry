const SerialPort = require('serialport')
const config = require('./config.json')

class ArduinoNFC{
	constructor(){
		this.port = new SerialPort(`COM${config.COM}`, { autoOpen: false, baudRate: config.baudRate })
		this._currentOutput = ''
		this._currentTask = null
		this._outputWaiting = null
		this._ready = false
		this.isRealTimeOn = false
		this.port.on('data', data=>{
			//console.log(data)
			//console.log(data.toString())
			let i
			for(i=0; i< data.length; i++){
				if(data[i] == 10 || data[i] == 13){
					this._eval(this._currentOutput)
					this._currentOutput = ''
				}
				else if(data[i] != 254)
					this._currentOutput+= String.fromCharCode(data[i])
			}
		})

	}
	open(){
		return new Promise((resolve, reject)=>{
			this.port.open(err=>{
				if(err) reject(err)
				this._waitFor(()=>this._ready == true, 300).then(()=>{
					resolve()
				})
			})
		})
	}
	_send(str, isCmd = false){
		if(!isCmd && str[0] == config.cmdchar )
			throw Error('Operation not allowed')
		let send = (isCmd)? config.cmdchar+str : str
		if(this.port.write(send)) return
		else{
			throw Error('serialport.write Error')
		}
	}
	_eval(data){
		if(data == "START!"){
			this._ready = true
			return
		}
		if(this._currentTask == null) return
		if(data == "ERROR!" || data == "TIMEOUT!"){
			this._currentTask.P.reject(data)
			this._currentTask = null
		}
		else if(this._currentTask.expect == data){
			this._currentTask.P.resolve(this._outputWaiting)
			this._outputWaiting = null
			this._currentTask = null
		}
		else
			this._outputWaiting = data
		return
	}
	_setData(data){
		return new Promise((resolve,reject)=>{
			this._currentTask = {expect:"endS", P:{resolve,reject} }
			this._send(data)
		})
	}
	read(){
		return new Promise((resolve,reject)=>{
			this._currentTask = {expect:"endR", P:{resolve,reject} }
			this._send('nfcR', true)
		})
	}
	write(data){
		return new Promise((resolve,reject)=>{
			this._setData(data).then(()=>{
				this._currentTask = {expect:"endW", P:{resolve,reject} }
				try{
					this._send("nfcW", true)
				}
				catch(err){
					reject(err)
				}
			})

		})
	}
	_setTimeOut(time_ml){
		return new Promise((resolve,reject)=>{
			this._currentTask = {expect:"endT", P:{resolve,reject} }
			this._send( `nfcT${time_ml}`, true)
		})
	}
	_waitFor(func, time){
		return new Promise((resolve)=>{
			if(func() === true)
				resolve()
			setTimeout(()=>{
				resolve(this._waitFor(func,time))
			}, time)
		})
	}
	async realTimeReadOn(onTag){
		if(this._currentTask != null)
			await this._waitFor(()=>this._currentTask == null, 500)
		await this._setTimeOut(config.timeout)
		this.isRealTimeOn = true
		this._realTimeRead(onTag)
	}
	async realTimeReadOff(){
		this.isRealTimeOn = false
		if(this._currentTask != null)
			await this._waitFor(()=>this._currentTask == null, 1000)
		await this._setTimeOut(500)
	}
	async _realTimeRead(onTag){
		let result
		try{
			result = await this.read()
			onTag(null, result)
		}
		catch(err){
			onTag(err)
		}
		
		if(this.isRealTimeOn)
			return this._realTimeRead(onTag)
		else
			return
	}
}

module.exports = ArduinoNFC