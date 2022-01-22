const { parseTime, extractBracket } = require('./util')

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
    Bool: new Type('Bool', (value)=>['true', '1'].includes(value.toLowerCase()), false),
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

    usage(){
        let positionals = this.positionals().map((arg) => arg.name).join(' ')
        let optionals = this.optionals().map((arg) => `[${this.argPrefix+arg.name} ${arg.type.name}]`).join(' ')

        return `${this.name} ${optionals} ${positionals}`
    }

    optionalsDesc() {
        return this.argDesc(this.optionals(), this.argPrefix, true)
    }

    positionalsDesc() {
        return this.argDesc(this.positionals())
    }

    argDesc(args, prefix='', includeDefault=false){
        let length = Math.max(...args.map((arg) => arg.name.length)) + prefix.length + 3

        return args.map((arg) => {

            let name = ` ${prefix+arg.name}`.padEnd(length, ' ')
            let desc = arg.options.description ? arg.options.description : ''
            let type = arg.type.name
            let defaultValue = arg.default()

            return `${name} ${desc} (type: ${type})`
            + (includeDefault ? ` (default: ${defaultValue})` : '')
        })
    }

    sort(args, positionals, posArgs={}, optArgs={}){

        if(args.trim() == '') {
            return {posArgs, optArgs}
        }

        let split = args.split(' ')

        if(split[0].startsWith(this.argPrefix)){
            let name = split.splice(0, 1)[0].substr(this.argPrefix.length)
            let value = extractBracket(split)
            optArgs[name] = value
        }
        else {
            let i = Object.keys(posArgs).length
            let value = extractBracket(split)
            let name = positionals[i].name
            posArgs[name] = value
        }

        return this.sort(split.join(' '), positionals, posArgs, optArgs)
    }

    parseArguments(args) {

        let values = []
        let pos = this.positionals()

        let {posArgs, optArgs} = this.sort(args, pos)
        
        for(let [name, arg] of this.args.entries()) {
            if(arg.required()){
                if(posArgs[name] === undefined) {
                    throw `${name} is required`
                }
    
                values.push(arg.parse(posArgs[name]))
            }
            else{
                values.push(Object.prototype.hasOwnProperty.call(optArgs, name) ? arg.parse(optArgs[name]) : arg.default())
            }
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

    optionals() {
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

        try {
            args = cmd.parseArguments(args)
            let res = await cmd.action(...args)
            return res
        }
        catch(err) {
            console.log(err.toString(), err.stack)
            throw this.help(cmd.name)
        }
        
    }

    help(name){
        let cmd = this.cmds[name]
        if(!cmd) {
            return `command not found`
        }

        let desc = cmd.description()
        let usage = cmd.usage()
        let optionals = cmd.optionalsDesc()
        let positionals = cmd.positionalsDesc()

        return `usage: ${this.prefix}${usage}`
        + (desc ? `\n\n${desc}` : '')
        + (positionals.length > 0 ? `\n\npositional arguments:\n${positionals.join('\n')}` : '')
        + (optionals.length > 0 ? `\n\noptions:\n${optionals.join('\n')}` : '')
    }

}

module.exports = {
    CommandHandler,
    ArgType
}