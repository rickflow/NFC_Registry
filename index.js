const sqlite3 = require('sqlite3');
const http = require('http');
const fs = require('fs');
const SerialPort = require('serialport');
const ReadLine = SerialPort.parsers.Readline;
const config = require("./config.json");

console.log(config);

//ARDUINO
const arduino = new SerialPort(config.com,{
    baudRate: config.baudRate
});

const parser = new ReadLine();
arduino.pipe(parser);

let arduinoBusy = true;
let turnOffAttendance = true;

const writeTag = (id)=>{
    if(arduinoBusy) return false;
    arduinoBusy = true;
    return new Promise((success, unSuccesful)=>{
        new Promise( (resolve, reject)=>{
            parser.once('data', (data)=>{
                if(data == 'endS\r') resolve();
                else reject();
            });
        }).then(()=>{
            console.log("SET SUCCESS");
            let endW = new Promise((resolve, reject)=>{
                parser.once('data', (data)=>{
                    if(data == 'endW\r') resolve();
                    else if (data == 'TIMEOUT!\r') reject("TIMEOUT!");
                    else reject();
                });
            });
            arduino.write('nfcW');
            return endW;
        }).then(()=>{
            console.log("WRITING SUCCESS");
            arduinoBusy = false;
            success(true);
        }).catch((err)=>{
            unSuccesful(err);
            if(err === "TIMEOUT!"){
                console.log("WRITE TIMEOUT");
                arduinoBusy=false;
            }
        });
        arduino.write(id.toString());
    });
    
}


const readTag = () =>{
    if(arduinoBusy) return false;
    arduinoBusy = true;
    return new Promise((tagReaded, tldr)=>{
        let customTimeout = setTimeout(()=>{tldr("TIMEOUT!")},2500);
        new Promise((resolve, reject)=>{
            parser.once('data', (data)=>{
                parser.pause();
                console.log("READED DATA: "+data);
                if(data == 'TIMEOUT!\r')reject("TIMEOUT!");
                resolve(data);
            });
        }).then((id)=>{
            return new Promise( (resolve, reject)=>{
                parser.resume();
                parser.once('data', (data)=>{
                    console.log("EXPECTING endR, RECEIVING: "+data);
                    if(data === 'endR\r') resolve(id);
                    else reject();
                });
            });
        }).then( (id)=>{
            arduinoBusy = false;
            console.log("READ SUCCESS, RETURNING: "+id);
            let idn = id.match(/\d+/)[0];
            if(idn) tagReaded(idn);
            else tagReaded(id);
            clearTimeout(customTimeout);
        } ).catch((err)=>{
            if(err === "TIMEOUT!"){
                parser.resume();
                arduinoBusy=false;
            }else{
                console.log("FATAL ERROR");
            }
            tldr(err);
        });
        arduino.write('nfcR');
        console.log("Reading...");
    });
}

const attendanceMode = ()=>{
    if(turnOffAttendance) {
        arduinoBusy = false;
        return;
    };
    let p = readTag();
    p.then((resolved)=>{
        console.log("AN ID WAS FOUND!!!!"+" "+resolved);
        
        attendanceAdd(resolved).then((success)=>{
            if(success)console.log("ATTENDANCE TAKEN "+resolved);
            else console.log("ATTENDANCE FAILED "+resolved);
        })
        
        setTimeout(attendanceMode, 1000);
    }).catch((err)=>{
        if(err === "TIMEOUT!"){
            console.log("Retrying...");
            arduinoBusy = false;
            setTimeout(attendanceMode, 1000);
        }
        else throw err;
    })
}




parser.once('data', (data)=>{
    if(data !== "START!\r") throw new Error("Wrong arduino configuration");
    else {
        console.log("Arduino online");
        arduinoBusy = false;
    }
})



// DATABASE
let ready =false;
const QUERIES =[
    "PRAGMA foreign_keys = ON",
    "CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY, name NOT NULL)",
    "CREATE TABLE IF NOT EXISTS attendance(day default (date('now', 'localtime')), hour default(time('now', 'localtime')), studentid INTEGER NOT NULL, UNIQUE(day, studentid) FOREIGN KEY(studentid) REFERENCES students(id))"
];

let db = new sqlite3.Database(config.database, (err)=>{
    if(err)throw err;
    db.run(QUERIES[0], (err)=>{
        if(err) throw err;
        db.run(QUERIES[1], (err)=>{
            if(err)throw err;
            db.run(QUERIES[2], (err)=>{
                if(err)throw err;
                console.log("DB READY");
                ready = true;
            });
        });
    });
});


// DATABASE METHODS/ PROMISES
const getStudents = () =>{
    return new Promise( (resolve,reject)=>{
        db.all("SELECT * FROM students", (err,rows)=>{
            //if(err) reject(err);
            if(err) throw err;
            resolve(rows);
        });
    });
}

const addStudent = (name, id)=>{
    return new Promise( (resolve, reject)=>{
        db.run("INSERT INTO students (id, name) VALUES (?, ?)", [id, name], (err)=>{
            if(err) resolve(false);
            resolve(true);
        });
    });
}

const deleteStudent = (id)=>{
    return new Promise((resolve, reject)=>{
        db.run("DELETE FROM students WHERE id = ?", [id], (err)=>{
            if(err) resolve(false);
            resolve(true);
        } );
    });
}

const attendanceShow = () =>{
    return new Promise((resolve, reject)=>{
        db.all("SELECT a.day, s.name, s.id, a.hour FROM attendance a JOIN students s ON s.id = a.studentid", (err,rows)=>{
            if(err)throw err;
            resolve(rows);
        })
    })
}

const attendanceShowDay = (date) =>{
    return new Promise((resolve, reject)=>{
        db.all("SELECT a.day, s.name, s.id, a.hour FROM attendance a JOIN students s ON s.id = a.studentid WHERE a.day = ?", [date] , (err,rows)=>{
            if(err)throw err;
            resolve(rows);
        })
    })
}

const attendanceAdd = (id) =>{    
    return new Promise((resolve,reject)=>{
        db.run("INSERT INTO attendance (studentid) VALUES (?)", [id], (err)=>{
            if(err) resolve(false);
            else resolve(true);
        })
    })
}
//REQUESTS
const pages = {
    '/': 'src/index.html',
    '/students':'src/students.html',
    '/setTag':'src/tag.html',
    '/attendance':'src/attendance.html',
    '/attendanceToday':'src/attendanceT.html'
}



//SERVER
http.createServer((req,res)=>{
    if(!ready){
        res.writeHead(503);
        res.end();
    }
    else if(pages[req.url]){
        fs.readFile(pages[req.url], (err,data)=>{
            if(err){
                res.writeHead(404);res.end();
            }
            res.end(data);
        })
    }
    else if (req.url === "/db/attendance"){
        if(req.method === "GET"){
            attendanceShow().then((resolved)=>{
                
                res.end(JSON.stringify(resolved));
            })
        }
        if(req.method === "POST"){
            //YYYY-MM-DD
            req.once('data', (data)=>{
                let date = JSON.parse(data)['date'];
                attendanceShowDay(date).then((resolved)=>{
                    res.end(JSON.stringify(resolved));
                })
            })
        }
        if(req.method === "PUT"){
            req.once('data', (data)=>{
                let action = JSON.parse(data)['action'];
                if(action === true){
                    turnOffAttendance = false;
                    attendanceMode();
                    res.end();
                }
                else if (action === false){
                    turnOffAttendance = true;
                    res.end();
                }
                else{
                    res.end(JSON.stringify({on:!turnOffAttendance}));
                }
            })
        }
    }
    else if(req.url === "/db"){
        if(req.method === "GET"){
            getStudents().then((resolved)=>{
                res.end(JSON.stringify(resolved));
            })
        }
        if(req.method === "POST"){
            req.once('data', (data)=>{
                let student = JSON.parse(data);
                addStudent(student.name,student.id).then((resolved)=>{
                    if(resolved){
                        res.end();
                    }
                })
            })
        }
        if(req.method === "DELETE"){
            req.once('data', (data)=>{
                let id = JSON.parse(data).id;
                deleteStudent(id).then((resolved)=>{
                    if(resolved){
                        res.end();
                    }
                    else{
                        res.writeHead(404);
                        res.end();
                    }
                })
            })
        }
    }
    else if(req.url === "/arduino"){
        if(req.method === "GET"){
            readTag().then((resolved)=>{
                res.end(JSON.stringify({data: resolved}));
            }).catch(()=>{
                res.writeHead(404);
                res.end();
            })
        }
        if(req.method === "POST"){
            req.once('data', (data)=>{
                let id = JSON.parse(data)['id'];
                writeTag(id).then((resolved)=>{
                    if(resolved){
                        res.end();
                    }
                }).catch(()=>{
                    res.writeHead(404);
                    res.end();
                })
            })
        }
    }else{
        res.writeHead(404);
        res.end();
    }
    
    
}).listen({port: 80, host: 'localhost'});
