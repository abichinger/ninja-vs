const axios = require('axios').default;
const EventEmitter = require('events');
const fs = require('fs')

//Code Snippet from https://stackoverflow.com/a/321527
function partial(func /*, 0..n args */) {
    var args = Array.prototype.slice.call(arguments, 1);
    return function() {
        var allArguments = args.concat(Array.prototype.slice.call(arguments));
        return func.apply(this, allArguments);
    }.bind(this);
}

class Client extends EventEmitter{

    /**
     * 
     * @param {string} host 
     */
    constructor(host) {
        super()
        this.host = host
        this.base_url = host + '/cgi-bin/api.cgi?'
    }

    async validateToken() {
        if(!this.token){
            throw('Login required')
        }

        if(this.token.isValid()){
            return
        }
        else{
            await this.token.renew()
        }
    }

    /**
     * 
     * @param {string} username 
     * @param {string} password 
     */
    async login(username, password) {
        let res = await axios.post(`${this.base_url}cmd=Login&token=null`, [{
            "cmd":"Login",
            "action":0,
            "param":{
                "User":{
                    "userName":username,
                    "password":password
                }
            }
        }])
        if(res.status == 200){
            let renewal = partial.bind(this)(this.login, username, password)
            let data = res.data[0].value.Token
            this.token = new Token(data.name, data.leaseTime, renewal)

            this.emit('ready')
        }
        else {
            throw res
        }
    }

    snapUrl(){
        return `${this.base_url}cmd=Snap&channel=0&rs=wuuPhkmUCeI9WG7C&token=${this.token.value}`
    }

    async snap() {
        let res = await axios.get(`${this.base_url}cmd=Snap&channel=0&rs=wuuPhkmUCeI9WG7C&token=${this.token.value}`, {responseType: 'arraybuffer'})
        return Buffer.from(res.data, 'binary')
    }

    async saveSnap(path) {
        let buffer = await this.snap()
        fs.writeFileSync(path, buffer)
    }

    /**
     * 
     * @param {Date} start 
     * @param {Date} end 
     */
    async search(start, end=new Date()){
        await this.validateToken()

        let payload = [{
            "cmd":"Search",
            "action":0,
            "param":{
                "Search":{
                    "channel":0,
                    "onlyStatus":0,
                    "streamType":"main",
                    "StartTime":{
                        "year":start.getFullYear(),
                        "mon":start.getMonth()+1,
                        "day":start.getDate(),
                        "hour":start.getHours(),
                        "min":start.getMinutes(),
                        "sec":start.getSeconds()
                    },
                    "EndTime":{
                        "year":end.getFullYear(),
                        "mon":end.getMonth()+1,
                        "day":end.getDate(),
                        "hour":end.getHours(),
                        "min":end.getMinutes(),
                        "sec":end.getSeconds()
                    }
                }
            }
        }]

        let res = await axios.post(`${this.base_url}cmd=Search&token=${this.token.value}`, payload)
        return res.data[0].value.SearchResult.File || []
    }


    async download(source, path){
        await this.validateToken()

        let writer = fs.createWriteStream(path)
        let res = await axios.get(`${this.base_url}/api.cgi?cmd=Download&source=${source}&token=${this.token.value}`, {responseType:'stream'})

        res.data.pipe(writer)

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve)
            writer.on('error', reject)
        })
    }

}

class Token {
    
    /**
     * 
     * @param {string} value 
     * @param {number} leasetime in seconds 
     * @param {function} renewal 
     */
    constructor(value, leasetime, renewal){

        this.value = value
        this.leasetime = leasetime
        this.valid = true
        this.timeout = setTimeout(() => {
            this.valid = false
        }, this.leaseTime-1)
        this.renewal = renewal
    }

    isValid(){
        return this.valid
    }

    async renew(){
        await this.renewal()
    }

}

exports.Client = Client