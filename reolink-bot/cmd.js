const { parseTime } = require('./util')

class Type {

    constructor(name, parse, defaultValue) {
        this.name = name
        this.parse = parse
        this.default = defaultValue
    }
}

let ArgType = {
    Number: new Type('Number', (value) => {
        let res = parseInt(value)
        return !isNaN(res) ? res : undefined 
    }, 0),
    Float: new Type('Float', (value) => {
        let res = parseFloat(value)
        return !isNaN(res) ? res : undefined 
    }, 0),
    Bool: new Type('Bool', ()=>true, false),
    String: new Type('String', (value)=>value, ''),
    Time: new Type('Time', parseTime, 0),
    List: new Type('List', (value) => {
        return value.split(',').map((x) => x.trim())
    }, [])
}

class Argument {

    constructor(name, type, options){
        this.name = name
        this.type = type
        this.options = options || {}

        if(!this.required() && this.options.default === undefined){
            throw 'missing default value for optional argument '+name
        }
    }

    parse(value) {
        let res = this.type.parse(value)
        return res !== undefined ? res : this.default()
    }

    default() {
        return this.options.default !== undefined ? this.options.default : this.type.default
    }

    required() {
        return !!this.options.required
    }
}

class Command {

    constructor(name, action, options) {
        this.name = name
        this.action = action
        this.options = options || {}

        this.lastArgRequired = true
        this.argPrefix = '-'
        this.args = new Map()
    }

    addArgument(name, type, defaultValue, options) {
        let arg = new Argument(name, type, defaultValue, options)
        this.args.set(name, arg)
        return this
    }

    description() {
        return this.options.description ? this.options.description : ''
    }

    /*usage(){
        let args = this.positionals().map((arg) => arg.name)
        let options = this.options().map((arg) => arg.name)
    }*/

    parseArguments(args) {
        if(!args) {
            return []
        }

        args = args.split(this.argPrefix)
        let values = []

        let argMap = args.reduce((acc, arg) => {
            let index = arg.indexOf(' ')
            index = index > 0 ? index : arg.length
            let name = arg.substr(0, index)
            let value = arg.substr(index+1)
            acc[name] = value
            return acc
        }, {})

        console.log(argMap)

        for(let [name, arg] of this.args.entries()) {
            
            if(arg.required() && argMap[name] === undefined) {
                throw `${this.argPrefix+name} is required`
            }

            values.push(Object.prototype.hasOwnProperty.call(argMap, name) ? arg.parse(argMap[name]) : arg.default())
        }

        return values
    }

    filterArgs(fn){
        let res = []
        for(let [, arg] of this.args.entries()) {
            if (fn(arg)){
                res.push(arg)
            }
        }
        return res
    }

    positionals() {
        return this.filterArgs((arg) => arg.required())
    }

    options() {
        return this.filterArgs((arg) => !arg.required())
    }

}

class CommandHandler {

    constructor(prefix) {
        this.prefix = prefix
        this.cmds = {}

        this.register('list', () => {
            return {
                msg: Object.values(this.cmds).map((cmd) => `${this.prefix+cmd.name}: ${cmd.description()}`).join('\n')
            }
        }, {
            description: 'lists all commands'
        })
    }

    register(name, action, options) {
        let cmd = new Command(name, action, options)
        this.cmds[name] = cmd
        return cmd
    }

    async execute(cmdStr){
        if(!cmdStr.startsWith(this.prefix)){
            return
        }
        let [name, ...args] = cmdStr.substr(this.prefix.length).split(' ')
        args = args.join(' ')

        let cmd = this.cmds[name]

        if (!cmd) {
            throw 'invalid command'
        }
        
        args = cmd.parseArguments(args)
        console.log(args)
        let res = await cmd.action(...args)
        return res
    }

}

module.exports = {
    CommandHandler,
    ArgType
}