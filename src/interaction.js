const { MessageButton, MessageActionRow } = require("discord.js")


class PageCollection {

    constructor(homepage=null, globButtons=[], globActions={}) {
        this.history = [homepage]
        this.pages = {}
        this.params = {}
        this.homepage = homepage
        this.globButtons = globButtons
        this.globActions = globActions
    }

    hasPage(name) {
        return this.pages[name] !== undefined
    }

    addPage(name, text) {
        let page = new Page(name, text, this.globButtons, this.globActions)
        this.pages[name] = page
        return page
    }

    currentPage(){
        return this.history[this.history.length-1]
    }

    goTo(name) {
        if(!this.hasPage(name)){
            return {content: `Page '${name}' not found`}
        }
        this.history.push(name)
        return this.pages[name].render()
    }

    goBack() {
        if(this.history.length <= 1) return
        this.history.pop()
        this.goTo(this.currentPage())
    }

    goHome() {
        this.history = []
        return this.goTo(this.homepage)
    }

    setParam(name, value) {
        this.params[name] = value
    }

    getParam(name) {
        return this.params[name]
    }

    execute(customId) {
        let page = this.pages[this.currentPage()]
        let action = page.getAction(customId)
        if(!action) return {content: `action '${customId}' not found`}
        return action({collection:this, page:page})
    }
}

class Page {

    constructor(name, text, buttons=[], actions={}){
        this.name = name
        this.text = text
        this.buttons = buttons
        this.actions = actions
    }

    //action params: interaction, collection, page
    addButton(options, action){
        let button = new MessageButton(options)
        this.buttons.push(button)
        this.actions[options.customId] = action
        return this
    }

    render() {
        let row = new MessageActionRow().addComponents(...this.buttons)
        return { content: this.text, components: [row] }
    }

    getAction(customId){
        let action = this.actions[customId]
        if(!action) return
        return action
    }

}

//https://medium.com/@adrien.za/creating-callable-objects-in-javascript-fbf88db9904c
class Callable extends Function {
    constructor(){
        super()
        return new Proxy(this, {
            apply: (target, thisArg, argArray) => {
                return target._call(...argArray)
            }
        })
    }

    _call() {
        throw `override _call`
    }
}

class GoTo extends Callable {

    constructor(target){
        super()
        this.target = target
    }

    _call({collection}){
        return collection.goTo(this.target)
    }

}

class GoHome extends Callable {

    constructor(){
        super()
    }

    _call({collection}){
        return collection.goHome()
    }

}

class GoBack extends Callable {

    constructor(){
        super()
    }

    _call({collection}){
        return collection.goBack()
    }

}

class SetParam extends Callable {

    constructor(name, value) {
        super()
        this.name = name
        this.value = value
    }

    _call({collection}){
        return collection.setParam(this.name, this.value)
    }

}

class IncParam extends Callable {

    constructor(name, step, max) {
        super()
        this.name = name
        this.step = Math.abs(step)
        this.max = max
    }

    _call({collection}){
        let value = collection.getParam(this.name)
        return collection.setParam(this.name, Math.min(this.max, value+this.step))
    }

}

class DecParam extends Callable {

    constructor(name, step, min) {
        super()
        this.name = name
        this.step = -Math.abs(step)
        this.min = min
    }

    _call({collection}){
        let value = collection.getParam(this.name)
        return collection.setParam(this.name, Math.max(this.min, value+this.step))
    }

}

class CallFunction extends Callable {

    constructor(fn, args){
        super()
        this.fn = fn
        this.args = args
    }

    _call({collection}){
        let args = this.args ? this.args.map((argName) => collection.getParam(argName)) : []
        return this.fn(...args)
    }

}

module.exports = {
    PageCollection,
    Page,
    GoBack,
    GoHome,
    GoTo,
    SetParam,
    IncParam,
    DecParam,
    CallFunction
}
    