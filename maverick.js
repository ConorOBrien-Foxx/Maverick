const minimist = require("minimist");
const fs = require("fs");
const Decimal = require("decimal.js");
const ShuntingYard = require("shunt.js");
const ShuntingOperator = ShuntingYard.ShuntingOperator;
let D = (c) => Decimal(+c);
let chr = (c) => String.fromCharCode(c);
let flat = (x) => x.map ? x.map(flat).reduce((p, c) => p.concat(c), []) : x;

function vectorize(f, arity = f.length){
    if(arity === 1){
        function trav(item){
            if(Array.isArray(item)){
                return item.map(trav);
            } else {
                return f.bind(this)(item);
            }
        }
        
        return trav;
    } else if(arity === 2){
        function trav2(a, b){
            if(Array.isArray(a)){
                if(Array.isArray(b)){
                    if(b.length !== a.length){
                        throw new Error("length error");
                    }
                    return a.map((e, i) => trav2.bind(this)(e, b[i]));
                } else {
                    return a.map(e => trav2.bind(this)(e, b));
                }
            } else if(Array.isArray(b)){
                return b.map(e => trav2.bind(this)(a, e));
            } else {
                return f.bind(this)(a, b);
            }
        }
        return trav2;
    } else {
        throw new Error("unsupported arity " + arity);
    }
}

const range = (a, b) => a.lte(b) ? [a, ...range(a.add(1), b)] : [];

const numberRegex = /^[\d.]+$/;

class Maverick {
    constructor(str){}
    
    static tokenize(str){
        // preprocess
        str = str.replace(/@/g, "()");
        
        // tokenizer functions
        let opNames = [...Maverick.shuntingYard.system.keys()];
        let funcNames = [...Maverick.funcs.keys()];
        let allNames = [].concat(opNames, funcNames);
        allNames = allNames.sort((p, c) => c.length - p.length);
        let tokens = [];
        let index = 0;
        let cur = () => str[index];
        let advance = (n = 1) => { index += n; }
        let isNumPrefix = (e = cur()) => (numberRegex.test(e));
        let isNumBody = (e = cur()) => (numberRegex.test(e));
        let hasCharsLeft = () => index < str.length;
        let isWhiteSpace = (e = cur()) => (/^\s$/.test(e));
        let needle = (s) => str.indexOf(s, index) === index;
        let keepChars = ["(", ")", ","];
        const NO_FUNC = Symbol("NO_FUNC");
        let readFunc = () => {
            for(let op of allNames){
                if(needle(op)){
                    advance(op.length);
                    return op;
                }
            }
            return NO_FUNC;
        }
        let errorTokenNotFound = () => {
            let message = "unexpected token `" + cur() + "` at pos " + index + ", tok " + (tokens.length);
            throw new Error(message);
        }
        tokenizeLoop: while(hasCharsLeft()){
            if(isNumPrefix()){
                let build = "";
                while(isNumBody()){
                    build += cur();
                    advance();
                }
                tokens.push(build);
            } else if(isWhiteSpace()){
                // do nothing
                advance();
            } else if(keepChars.includes(cur())){
                tokens.push(cur());
                advance();
            } else if(cur() === "$"){
                advance();
                let success = readFunc();
                if(success !== NO_FUNC){
                    tokens.push("$" + success);
                    continue tokenizeLoop;
                }
                errorTokenNotFound();
            } else {
                let success = readFunc();
                if(success !== NO_FUNC){
                    tokens.push(success);
                    continue tokenizeLoop;
                }
                errorTokenNotFound();
            }
        }
        return tokens;
    }
    
    static parse(str){
        let shunted = Maverick.shuntingYard.parse(
            Maverick.tokenize(str)
        );
        return shunted;
    }
    
    static getOp(op){
        return Maverick.shuntingYard.system.get(op);
    }
    
    static execEffect(effect, ...args){
        let res;
        if(effect instanceof Array){
            res = effect[args.length - 1](...args);
        } else
            res = effect(...args);
        return res;
    }
    
    static traverse(toks){
        let stack = [];
        for(let tok of toks){
            if(numberRegex.test(tok)){
                stack.push(new Decimal(tok));
            } else if(tok[0] === "$"){
                let k = Maverick.getOp(tok.slice(1)).clone();
                k.toString = function(){
                    return tok;
                }
                stack.push(k);
            } else if(Maverick.funcs.has(tok)){
                let arity = stack.pop();
                let args = [];
                while(arity --> 0)
                    args.unshift(stack.pop());
                let effect = Maverick.funcs.get(tok);
                let res = Maverick.execEffect(effect, ...args);
                stack.push(res);
            } else if(tok instanceof ShuntingOperator){
                let arity = tok.arity;
                let args = [];
                while(arity --> 0)
                    args.unshift(stack.pop());
                let effect = tok.opts.effect;
                stack.push(Maverick.execEffect(effect, ...args));
            }
        }
        return stack;
    }
    
    static exec(str){
        return this.traverse(this.parse(str));
    }
}

Maverick.outted = false;

Maverick.funcs = new Map([
    ["<>", (n = 0) => process.argv[+n - 2]],
    ["arg", (n = 0) => process.argv.slice(n + 2)],
    ["out", (...c) => {
        Maverick.outted = true;
        process.stdout.write(c.join``);
    }],
    ["outc", (...c) => {
        Maverick.outted = true;
        process.stdout.write(flat(c).map(chr).join(""));
    }],
]);

Maverick.shuntingYard = new ShuntingYard([
    //---------PRECEDENCE 0---------//
    new ShuntingOperator({
        name: "then",
        precedence: 0,
        variants: [2],
        associativity: "left",
        effect: (a, b) => b,
    }),
    //---------PRECEDENCE 1---------//
    new ShuntingOperator({
        name: "<",
        precedence: 1,
        variants: [2],
        associativity: "left",
        effect: (a, b) => D(a.lt(b)),
    }),
    new ShuntingOperator({
        name: "<=",
        precedence: 1,
        variants: [2],
        associativity: "left",
        effect: (a, b) => D(a.lte(b)),
    }),
    new ShuntingOperator({
        name: ">",
        precedence: 1,
        variants: [2],
        associativity: "left",
        effect: (a, b) => D(a.gt(b)),
    }),
    new ShuntingOperator({
        name: ">=",
        precedence: 1,
        variants: [2],
        associativity: "left",
        effect: (a, b) => D(a.gte(b)),
    }),
    new ShuntingOperator({
        name: "=",
        precedence: 1,
        variants: [2],
        associativity: "left",
        effect: (a, b) => D(a.eq(b)),
    }),
    
    //---------PRECEDENCE 2---------//
    new ShuntingOperator({
        name: "//",
        precedence: 1,
        variants: [2],
        associativity: "left",
        effect: (a, b) => {
            if(a.length <= 2 || !a.reduce)
                return a;
            return a.reduce((p, c) => b.opts.effect(p, c));
        },
    }),
    
    //---------PRECEDENCE 3---------//
    new ShuntingOperator({
        name: "+",
        precedence: 3,
        variants: [2],
        associativity: "left",
        effect: vectorize((a, b) => a.add(b)),
    }),
    new ShuntingOperator({
        name: "-",
        precedence: 3,
        variants: [1, 2],
        associativity: "left",
        effect: [ vectorize((a) => a.neg()), vectorize((a, b) => a.sub(b)) ],
    }),
    
    //---------PRECEDENCE 4---------//
    new ShuntingOperator({
        name: "*",
        precedence: 4,
        variants: [2],
        associativity: "left",
        effect: vectorize((a, b) => a.mul(b)),
    }),
    new ShuntingOperator({
        name: "/",
        precedence: 4,
        variants: [2],
        associativity: "left",
        effect: vectorize((a, b) => a.div(b)),
    }),
    new ShuntingOperator({
        name: "%",
        precedence: 4,
        variants: [2],
        associativity: "left",
        effect: vectorize((a, b) => a.mod(b)),
    }),
    
    //---------PRECEDENCE 5----------//
    new ShuntingOperator({
        name: "^",
        precedence: 5,
        variants: [2],
        associativity: "right",
        effect: vectorize((a, b) => a.pow(b)),
    }),
    
    //---------PRECEDENCE 10----------//
    new ShuntingOperator({
        name: ":",
        precedence: 10,
        variants: [1, 2],
        associativity: "left",
        effect: [vectorize((a) => range(D(0), a)), vectorize(range)],
    }),
    
    //---------PRECEDENCE 15---------//
    new ShuntingOperator({
        name: "`",
        precedence: 15,
        variants: [2],
        associativity: "left",
        effect: (a, b) => [...[].concat(a), b],
    }),
], {
    isLiteral: (e) => numberRegex.test(e) || e[0] === "$",
    isFunction: (e) => {
        // console.log(e+[]);
        return Maverick.funcs.has(e) || e[0] === "$";
    },
});

let readFile = (name) => {
	if(!name){
		err("no file passed");
	}
	try {
		return fs.readFileSync(name).toString();
	} catch(e){
		err("no such file `" + name + "`");
	}
}

const disp = (x) =>
    Array.isArray(x) ? "(" + x.map(disp).join("`") + ")" :
        typeof x === "undefined" ? "undef" : x.toString();

if(require.main === module){
    let args = require("minimist")(process.argv.slice(2), {
        alias: {
            "e": "exec",
			"f": "file",
            "o": "out"
        },
        boolean: "o"
    });
    let prog;
    if(args.exec){
        prog = args.exec.toString();
    } else {
        let fileName = args.file ? args.file : args._.shift();
		prog = readFile(fileName);
    }
    Maverick.funcs.set("<>", (n = 0) => new Decimal(args._[+n]));
    Maverick.funcs.set("arg", (n = 0) => args._.slice(n).map(D));
    // console.log(Maverick.tokenize(prog).join(" "));
    // console.log(Maverick.parse(prog).join(" "));
    let res = Maverick.exec(prog);
    if(res.length === 1) res = res.pop();
    if(args.out || !Maverick.outted)
        process.stdout.write(disp(res));
}