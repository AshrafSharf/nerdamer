/*
 * Author : Martin Donk
 * Website : http://www.nerdamer.com
 * Email : martin.r.donk@gmail.com
 * Source : https://github.com/jiggzson/nerdamer
 */

//TODO: test sqrt
//TODO: imaginary
//TODO: functions don't evaluate
//TODO: Symbols must return decimal where possible

var nerdamer = (function() {
    "use strict";
    
    var version = '0.6.0',
        _ = new Parser(), //nerdamer's parser
    
        Groups = {},
        
        //this is the class which holds the utilities which are exported to the core
        //All utility functions which are to be made available to the core should be added to this object
        Utils = {},
        
        //Settings
        Settings = {
            exclude: [],
            //If you don't care about division by zero for example then this can be set to true. 
            //Has some nasty side effects so choose carefully.
            suppress_errors: false,
            //the global used to invoke the libary to parse to a number. Normally cos(9) for example returns
            //cos(9) for convenience but parse to number will always try to return a number if set to true. 
            PARSE2NUMBER: false,
            //this flag forces the a clone to be returned when add, subtract, etc... is called
            SAFE: false,
            //the symbol to use for imaginary symbols
            IMAGINARY: 'i',
            
            BIGNUM: undefined
        },

        //Add the groups. These have been reorganized as of v0.5.1 to make CP the highest group
        //The groups that help with organizing during parsing. Note that for FN is still a function even 
        //when it's raised to a symbol, which typically results in an EX
        N   = Groups.N  = 1, // A number
        P   = Groups.P  = 2, // A single variable e.g. x. 
        S   = Groups.S  = 3, // A single variable e.g. x. 
        EX  = Groups.EX = 4, // An exponential
        FN  = Groups.FN = 5, // A function
        PL  = Groups.PL = 6, // A symbol/expression having same name with different powers e.g. 1/x + x^2
        CB  = Groups.CB = 7, // A symbol/expression composed of one or more variables through multiplication e.g. x*y
        CP  = Groups.CP = 8, // A symbol/expression composed of one variable and any other symbol or number x+1 or x+y
        
        CONST_HASH = '#',
        
        //GLOBALS
        
        PARENTHESIS = 'parens',

        //the function which represent vector
        VECTOR = 'vector',

        SQRT = 'sqrt',
        
        ABS = 'abs',
        
        //the idea is to have the ability to do some processing on the string before passing it
        //to the parser. EXPERIMENTAL and might be stripped.
        PREPROCESSORS = [],

        //the storage container "memory" for parsed expressions
        EQNS = [],
        
        //variables
        VARS = {},
        
        //the container used to store all the reserved functions
        RESERVED = [],
        
        //convert constant from Math object
        MCONST = function(x) {
            var s = new Symbol(1);
            s.multiplier = Fraction.quickConversion(Math[x.toUpperCase()]);
            return s;
        },
        
        /**
         * Checks to see if value is one of nerdamer's reserved names
         * @param {String} value
         * @return boolean
         */
        isReserved = Utils.isReserved = function(value) { 
            return RESERVED.indexOf(value) !== -1;
        },
        
        /**
         * Use this when errors are suppressible
         * @param {String} msg
         */
        err = function(msg) {
            if(!Settings.suppress_errors) throw new Error(msg);
        },
        
        /**
         * Enforces rule: "must start with a letter or underscore and 
         * can have any number of underscores, letters, and numbers thereafter."
         * @param name The name of the symbol being checked
         * @param {String} typ - The type of symbols that's being validated
         * @throws {Exception} - Throws an exception on fail
         */
        validateName = Utils.validateName = function(name, typ) {
            typ = typ || 'variable';
            var regex = /^[a-z_][a-z\d\_]*$/gi;
            if(!(regex.test( name)) ) {
                throw new Error(name+' is not a valid '+typ+' name');
            }
        },
        
        /**
         * Replace n! to fact(n)
         * @param {String}
         */
        
        insertFactorial = Utils.insertFactorial = function(expression) {
            var factorial;
            var regex = /(\d+|\w+)!/ig;
            do {
                factorial = regex.exec(expression);
                if (factorial !== null) {
                    expression = expression.replace(factorial[0], 'fact(' + factorial[0] + ')').expression.replace('!', '');
                }
            } while(factorial);
            return expression;
        },
        
        /**
         * Checks to see if a number or Symbol is a fraction
         * @type {Number|Symbol} num
         * @returns {boolean}
         */
        isFraction = Utils.isFraction = function(num) {
            if(isSymbol(num)) return isFraction(num.multiplier);
            return (num % 1 !== 0);
        },
        
        /**
         * Checks to see if the object provided is a Symbol
         * @param {Object} obj
         */
        isSymbol = Utils.isSymbol = function(obj) {
            return (obj instanceof Symbol);
        },
        
        /**
         * 
         * Checks to see if the object provided is a Vector
         * @param {Object} obj
         */
        isVector = Utils.isVector = function(obj) {
            return (obj instanceof Vector);
        },
        
        /**
         * Checks to see if the object provided is a Matrix
         * @param {Object} obj
         */
        isMatrix = Utils.isMatrix = function(obj) {
            return (obj instanceof Matrix);
        },
        
        /**
         * @param {Symbol} symbol
         */
        isNumericSymbol = Utils.isNumericSymbol = function(symbol) {
            return symbol.group === N;
        },

        /**
         * Checks to see if the object provided is an Array
         * @param {Object} arr
         */
        isArray = Utils.isArray = function(arr) {
            return arr instanceof Array;
        },

        /**
         * Checks to see if a number is an integer
         * @param {Number} num
         */
        isInt = Utils.isInt = function(num) {
            return num % 1 === 0;
        },

        /**
         * @param {Number|Symbol} obj
         * @returns {boolean}
         */
        isNegative = Utils.isNegative = function(obj) {
            if( isSymbol(obj) ) {
                obj = obj.multiplier;
            }
            return obj < 0;
        },
        
        /**
         * Checks to see if symbol is a symbol of symbols held together by addition
         * e.g. (x+z+6) or (x^2+x) etc
         * @param {Symbol} symbol
         * @return {boolean}
         */
        isComposite = Utils.isComposite = function(symbol) {
            return (symbol.group === PL || symbol.group === CP);
        },
        
        /**
         * @param {String} str
         * @returns {String} - returns a formatted string surrounded by brackets
         */
        inBrackets = Utils.inBrackets = function(str) {
            return '('+str+')';
        },
        
        /**
         * A helper function to replace parts of string
         * @param {String} str - The original string
         * @param {Integer} from - The starting index
         * @param {Integer} to - The ending index
         * @param {String} with_str - The replacement string
         * @returns {String} - A formatted string
         */
        stringReplace = Utils.stringReplace = function(str, from, to, with_str) {
            return str.substr(0, from)+with_str+str.substr(to, str.length);
        },
        
        /**
         * the Parser uses this to check if it's allowed to convert the obj to type Symbol
         * @obj {Object} obj
         * @returns {boolean}
         * @description
         */
        customType = Utils.customType = function(obj) {
            return obj !== undefined && obj.custom;
        },
        
        /**
         * Checks to see if numbers are both negative or are both positive
         * @param {Number} a
         * @param {Number} b
         * @returns {boolean}
         */
        sameSign = Utils.sameSign = function(a, b) {
            return (a < 0) === (b < 0);
        },
        
        /**
         * A helper function to replace multiple occurences in a string. Takes multiple arguments
         * @example format('{0} nice, {0} sweet')
         * //returns 'something nice, something sweet'
         */
        format = Utils.format = function() {
            var args = [].slice.call(arguments),
                str = args.shift();
                return str.replace(/{(\d+)}/g, function(match, index) {
                    var arg = args[index];
                    return typeof arg === 'function' ? arg() : arg;
                });
        },
        
        /**
         * Returns an array of all the keys in an array
         * @param {Object} obj
         * @returns {Array}
         */
        keys = Utils.keys = function( obj ) {
//            return Object.keys(obj);
//            //TBD
            var k = [];
            for( var key in obj ) { k.push( key ); }
            return k;
        },

        /**
         * Returns the first encountered item in an object. Items do not have a fixed order in objects 
         * so only use if you need any first random or if there's only one item in the object
         * @param {Object} obj
         * @returns {*}
         */
        firstObject = Utils.firstObject = function(obj) {
            for( var x in obj ) break;
            return obj[x];
        },
        
        /**
         * Returns the minimum number in an array
         * @param {Array} arr
         * @returns {Number} 
         */
        arrayMax = Utils.arrayMax = function(arr) {
            return Math.max.apply(undefined, arr);
        },

        /**
         * Returns the maximum number in an array
         * @param {Array} arr
         * @returns {Number} 
         */
        arrayMin = Utils.arrayMin = function(arr) {
            return Math.min.apply(undefined, arr);
        },
        
        /**
         * Rounds a number up to x decimal places
         * @param {Number} x
         * @param {Number} s
         */
        round = Utils.round = function( x, s ) { 
            s = s || 14;
            return Math.round( x*Math.pow( 10,s ) )/Math.pow( 10,s );
        },
        
        /**
         * Inserts an object into an array at a given index or recursively adds items if an array is given.
         * When inserting another array, passing in false for unpackArray will result in the array being inserted
         * rather than its items.
         * @param {Array} arr - The target array
         * @param {Array} item - The item being inserted
         * @param {Number} index - Where to place the item
         * @param {boolean} unpackArray - Will insert the array instead of adding its items
         */
        insertArray = Utils.insertArray = function( arr, item, index, unpackArray ) {
            unpackArray = unpackArray === false ? unpackArray : true;

            if( isArray( item ) && unpackArray ) {
                for( var i=0; i<=item.length+1; i++ ){
                    insertArray( arr, item.pop(), index );
                }
            }
            else if( typeof index === 'undefined ') {
                arr.push( item );
            }
            else{
                arr.splice( index, 0, item );
            }
        },
        
        /**
         * This method traverses the symbol structure and grabs all the variables in a symbol. The variable
         * names are then returned in alphabetical order.
         * @param {Symbol} obj
         * @param {Object} vars - An object containing the variables. Do not pass this in as it generated 
         * automatically. In the future this will be a Collector object.
         * @returns {String[]} - An array containing variable names
         */
        variables = Utils.variables = function( obj, vars ) { 
            vars = vars || {
                c: [],
                add: function(value) {
                    if(this.c.indexOf(value) === -1 && isNaN(value)) this.c.push(value);
                }
            };

            if(isSymbol(obj)) { 
                var group = obj.group,
                    prevgroup = obj.previousGroup;
                if(group === CP || group === CB || prevgroup === CP || prevgroup === CB) {
                    for(var x in obj.symbols) variables(obj.symbols[x], vars);
                }
                else if(group === S) {
                    vars.add(obj.value);
                }
                else if(group === PL) {
                    variables(firstObject(obj.symbols), vars);
                }
                else if(group === EX) { 
                    if(!isNaN(obj.value)) vars.add(obj.value);
                    variables(obj.power, vars);
                }
                else if(group === FN) {
                    for(var i=0; i<obj.args.length; i++) {
                        variables(obj.args[i], vars);
                    }
                }
            }
            return vars.c.sort();
        },
        
        /**
         * Loops through each item in object and calls function with item as param
         * @param {Object|Array} obj
         * @param {Function} fn 
         */
        each = Utils.each = function(obj, fn) {
            if(isArray(obj)) {
                var l = obj.length;
                for(var i=0; i<l; i++) fn.call(obj, i);
            }
            else {
                for(var x in obj) if(obj.hasOwnProperty(x)) fn.call(obj, x);
            }
        },
        
        /**
         * Checks to see if a number is an even number
         * @param {Number} num
         * @returns {boolean}
         */
        even = Utils.even = function(num) {
            return num % 2 === 0;
        },
        
        /**
         * Checks to see if a fraction is divisible by 2
         * @param {Number} num
         * @returns {boolean}
         */
        evenFraction = Utils.evenFraction = function(num) {
            return 1/( num % 1) % 2 === 0;
        },
        
        /**
         * Strips duplicates out of an array
         * @param {Array} arr
         */
        arrayUnique = Utils.arrayUnique = function(arr) {
            var l = arr.length, a = [];
            for(var i=0; i<l; i++) {
                var item = arr[i];
                if(a.indexOf(item) === -1) a.push(item);
            }
            return a;
        },
        
        /**
         * Reserves the names in an object so they cannot be used as function names
         * @param {Object} obj
         */
        reserveNames = Utils.reserveNames = function(obj) {
            var add = function(item) {
                if(RESERVED.indexOf(item) === -1) RESERVED.push(item);
            };
            
            if(typeof obj === 'string') add(obj);
            else {
                each(obj, function(x) {
                    add(x);
                });
            }  
        },

        /**
         * Removes an item from either an array or an object. If the object is an array, the index must be 
         * specified after the array. If it's an object then the key must be specified
         * @param {Object|Array} obj
         * @param {Integer} indexOrKey
         */
        remove = Utils.remove = function( obj, indexOrKey ) {
            var result;
            if( isArray(obj) ) {
                result =  obj.splice(indexOrKey, 1)[0];
            }
            else {
                result = obj[indexOrKey];
                delete obj[indexOrKey];
            }
            return result;
        },
        
        /**
         * Creates a temporary block in which one of the global settings is temporarily modified while
         * the function is called. For instance if you want to parse directly to a number rather than have a symbolic
         * answer for a period you would set PARSE2NUMBER to true in the block.
         * @example block('PARSE2NUMBER', function(){//symbol being parsed to number}, true);
         * @param {String} setting - The setting being accessed
         * @param {Function} f 
         * @param {boolean} opt - The value of the setting in the block
         * @param {String} obj - The obj of interest. Usually a Symbol but could be any object
         */
        block = Utils.block = function(setting, f, opt, obj) {
            var current_setting = Settings[setting];
            Settings[setting] = opt === undefined ? true : !! opt;
            var retval = f.call(obj);
            Settings[setting] = current_setting;
            return retval;
        },

        /**
         * Converts function arguments to an array. I had hopes for this function :(
         * @param {Object} obj - arguments obj
         */
        arguments2Array = Utils.arguments2Array = function(obj) {
            return [].slice.call(obj);
        },
        
        /**
         * Using a regex to get between brackets can be a bit tricky. This functions makes it more abstract 
         * to fetch between brackets within a string from any given index. If the starting index is a bracket 
         * then it will fail. returns [matched_string, first_bracket_index, end_bracket_index]
         * @param {Char} ob - open bracket
         * @param {Char} cb - close bracket
         * @param {String} str - The string being read
         * @param {Integer} start - Where in the string to start
         * @returns {Array}
         */
        betweenBrackets = function(ob, cb, str, start) {
            start = start || 0;
            var l = str.length,
                open = 0, fb;
            for(var i=start; i<l; i++) {
                var ch = str.charAt(i); //get the character at this position

                if(ch === ob) { //if an open bracket was found
                    if(fb === undefined) fb = i+1;//mark the first bracket found
                    open++; //mark a new open bracket
                }
                if(ch === cb) { //if a close bracket was found
                    open--; //close a bracket
                    if(open === 0 && fb !== undefined) {
                        var nb = i;
                        return [str.substring(fb, nb), fb, nb];
                    }
                }
            }
            
            return [];
        },
        
        /**
         * A helper function to make substitutions
         * @param {Object} subs
         */
        format_subs = function(subs) {
            for(var x in subs) subs[x] = _.parse(subs[x].toString());
            return subs;
        },
        
        /**
         * The idea is to have the ability to do some preprocessing on the string. This can have some nice 
         * possibilities such as being able to make a pseudo programming language and out the the result in the form
         * of an expression or equation. Currently not used
         * @param {String} str
         * @
         */
        preprocess = function(str) {
            var s = str;
            var l = PREPROCESSORS.length;
            for(var i=0; i<l; i++) {
                var preprocess = PREPROCESSORS[i];
                if(typeof preprocess === 'function') s = preprocess(s);
            }
            return s;
        },

        //This object holds additional functions for nerdamer. Think of it as an extension of the Math object.
        //I really don't like touching objects which aren't mine hence the reason for Math2. The names of the 
        //functions within are pretty self-explanatory.
        Math2 = {
            csc: function(x) { return 1/Math.sin(x); },
            sec: function(x) { return 1/Math.cos(x); },
            cot: function(x) { return 1/Math.tan(x); },
            //https://gist.github.com/kcrt/6210661
            erf: function(x){
                // erf(x) = 2/sqrt(pi) * integrate(from=0, to=x, e^-(t^2) ) dt
                // with using Taylor expansion,
                // = 2/sqrt(pi) * sigma(n=0 to +inf, ((-1)^n * x^(2n+1))/(n! * (2n+1)))
                // calculationg n=0 to 50 bellow (note that inside sigma equals x when n = 0, and 50 may be enough)
                var m = 1.00,
                    s = 1.00,
                    sum = x * 1.0;
                for(var i = 1; i < 50; i++){
                m *= i;
                s *= -1;
                sum += (s * Math.pow(x, 2.0 * i + 1.0)) / (m * (2.0 * i + 1.0));
                }
                return 2 * sum / Math.sqrt(3.14159265358979);
            },
            fact: function(x) {
                var retval=1;
                for (var i = 2; i <= x; i++) retval = retval * i;
                return retval;
            },
            mod: function(x, y) {
                return x % y;
            },
            GCD: function() {
                var args = [].slice.call(arguments)
                        .map(function(x){ return Math.abs(x); }).sort(),
                    a = Math.abs(args.shift()),
                    n = args.length;

                while(n-- > 0) {
                    var b = Math.abs(args.shift());
                    while(true) {
                        a %= b;
                        if (a === 0) {
                            a = b;
                            break;
                        }
                        b %= a;
                        if (b === 0) break;;
                    }
                }
                return a;
            }
        };
        
        //safeties
        Math.sign = Math.sign || function(x) {
            x = +x; // convert to a number
            if (x === 0 || isNaN(x)) {
                return x;
            }
            return x > 0 ? 1 : -1;
        };
        
        reserveNames(Math2); //reserve the names in Math2
        
    /* GLOBAL FUNCTIONS */
    /**
     * This method will return a hash or a text representation of a Symbol, Matrix, or Vector. 
     * If all else fails it *assumes* the object has a toString method and will call that.
     * 
     * @param {Object} obj
     * @param {String} option get is as a hash 
     * @returns {String}
     */
    function text(obj, option, useGroup) { 
        var asHash = option === 'hash'
        //if the object is a symbol
        if(isSymbol(obj)) { 
            var multiplier = '', 
            power = '',
            sign = '',
            group = obj.group || useGroup,
            value = obj.value;
            //if the value is to be used as a hash then the power and multiplier need to be suppressed
            if(!asHash) { 
                var om = obj.multiplier.toString();

                if(om == '-1') {
                    sign = '-';
                    om = '1';
                }
                //only add the multiplier if it's not 1
                if(om != '1') multiplier = om;

                var p = obj.power ? obj.power.toString() : '';
                //only add the multiplier 
                if(p != '1') {
                    //is it a symbol
                    if(isSymbol(p)) {
                        power = text(p);
                    }
                    else {
                        power = p;
                    }
                }
            }

            switch(group) {
                case N:
                    multiplier = '';
                    //if it's numerical then all we need is the multiplier
                    value = obj.multiplier == '-1' ? '1' : obj.multiplier.toString();
                    power = '';
                    break;
                case PL:
                    value = obj.collectSymbols(text).join('+').replace(/\+\-/g, '-');
                    break;
                case CP:
                    value = obj.collectSymbols(text).join('+').replace(/\+\-/g, '-');
                    break;
                case CB: 
                    
                    value = obj.collectSymbols(function(symbol){
                        var g = symbol.group;
                        //both groups will already be in brackets if their power is greater than 1
                        //so skip it.
                        if((g === PL || g === CP) && (symbol.power.equals(1) && symbol.multiplier.equals(1))) {
                            return inBrackets(text(symbol));
                        }
                        return text(symbol);
                    }).join('*');
                    break;
                case EX:
                    var pg = obj.previousGroup,
                        pwg = obj.power.group;
                
                    //PL are the exception. It's simpler to just collect and set the value
                    if(pg === PL) value = obj.collectSymbols(text).join('+').replace('+-', '-');
                    if(!(pg === N || pg === S || pg === FN) && !asHash) { value = inBrackets(value); }
 
                    if((pwg === CP || pwg === CB || pwg === PL || obj.power.multiplier.toString() != '1') && power) {
                        power = inBrackets(power);
                    }
                    break;
            }
            //wrap the power since / is less than ^
            //TODO: introduce method call isSimple
            if(power && !isInt(power) && group !== EX) { power = inBrackets(power); }

            //the following groups are held together by plus or minus. They can be raised to a power or multiplied
            //by a multiplier and have to be in brackets to preserve the order of precedence
            if(((group === CP || group === PL) && (multiplier && multiplier != '1' || sign === '-')) 
                    || ((group === CB || group === CP || group === PL) && (power && power != '1'))
                    || obj.fname === PARENTHESIS) { 
                
                value = inBrackets(value);
            }

            if(power < 0) power = inBrackets(power);
            if(multiplier) multiplier = multiplier + '*';
            if(power) power = '^' + power;

            return sign+multiplier+value+power;
        }
        else if(isVector(obj)) { 
            var l = obj.elements.length,
                c = [];
            for(var i=0; i<l; i++) c.push(obj.elements[i].text());
            return '['+c.join(',')+']';
        }
        else {
            return obj.toString();
        }
    }
    Utils.text = text;
    /* END GLOBAL FUNCTIONS */
    
    /**** CLASSES *****/
    /**
     * The Collector is used to find unique values within objects
     * @param {Function} extra_conditions - A function which performs a check on the values and returns a boolean
     * @returns {Collector}
     */
    function Collector(extra_conditions) {
        this.c = [];
        this.add = function(value) {
            var condition_true = extra_conditions ? extra_conditions(value) : true;
            if(this.c.indexOf(value) === -1 && condition_true) this.c.push(value);
        };
    }
    
    /**
     * Wraps a function name in this object
     * @param {String} fn_name
     * @returns {Func}
     */
    function Func(fn_name) {
        this.name = fn_name;
    }
    
    /** 
     * This is what nerdamer returns. It's sort of a wrapper around the symbol class and 
     * provides the user with some useful functions. If you want to provide the user with extra
     * library functions then add them to this class's prototype.
     * @param {Symbol} symbol
     * @returns {Expression} wraps around the Symbol class
     */
    function Expression(symbol) {
        this.symbol = symbol;
    }
    
    /**
     * Returns stored expression at index. For first index use 1 not 0.
     * @param {Integer} expression_number 
     */
    Expression.getExpression = function(expression_number, asType) {
        if(expression_number === 'last' || !expression_number) expression_number = EQNS.length;
        if(expression_number === 'first') expression_number = 1;
        var index = expression_number -1,
            expression = EQNS[index],
            retval = expression ? new Expression(expression) : expression;
        return retval;
    };
    
    Expression.prototype = {
        /**
         * Returns the text representation of the expression
         * @returns {String}
         */
        text: function() {
            return this.symbol.text('final');
        },
        /**
         * Returns the latex representation of the expression
         * @returns {String}
         */
        latex: function() {
            return Latex.latex(this.symbol);
        },
        
        valueOf: function() { 
            return this.symbol.valueOf();
        },
        
        /**
         * Evaluates the expression and tries to reduce it to a number if possible.
         * If an argument is given in the form of %{integer} it will evaluate that expression.
         * Other than that it will just use it's own text and reparse
         * @returns {Expression}
         */
        evaluate: function() {
            var first_arg = arguments[0], expression, idx = 1;
            if(typeof first_arg === 'string') {
                expression = (first_arg.charAt(0) === '%') ? Expression.getExpression(first_arg.substr(1)).text() : first_arg;
            }
            else if(first_arg instanceof Expression || isSymbol(first_arg)) {
                expression = first_arg.text();
            }
            else {
                expression = this.symbol.text(); idx--;
            }
            
            var subs = arguments[idx];

            return new Expression(block('PARSE2NUMBER', function() {
                return _.parse(expression, format_subs(subs));
            }, true));
        },
        /**
         * Converts a symbol to a JS function. Pass in an array of variables to use that order instead of 
         * the default alphabetical order
         * @param {Array}
         */
        buildFunction: function(vars) {
            return build(this.symbol, vars);
        },
        /**
         * Checks to see if the expression is just a plain old number
         * @returns {boolean}
         */
        isNumber: function() {
            return isNumericSymbol(this.symbol);
        },
        /**
         * Checks to see if the expression is infinity
         * @returns {boolean}
         */
        isInfinity: function() {
            return Math.abs(this.symbol.multiplier) === Infinity;
        },
        /**
         * Returns all the variables in the expression
         * @returns {Array}
         */
        variables: function() {
            return variables(this.symbol);
        },
        
        toString: function() {
            return this.symbol.text();
        },
        /**
         * Returns true if the expression is a monomial
         */
        isMonomial: function() {
            return this.symbol.group === S;
        },
        
        isFraction: function() {
            return isFraction(this.symbol);
        },
        
        isPolynomial: function() {
            return this.symbol.isPoly();
        }
    };
    
    function Frac(n) { 
        if(n === undefined) return this;
        if(isInt(n)) {
            this.num = n;
            this.den = 1;
        }
        else {
            var frac = Fraction.convert(n);
            this.num = frac[0];
            this.den = frac[1];
        }
    }

    Frac.prototype = {
        multiply: function(m) {
            var c = this.clone();
            c.num *= m.num;
            c.den *= m.den;
            return c.simplify();
        },
        divide: function(m) {
            if(m.num === 0) throw new Error('Division by zero!');
            return this.clone().multiply(m.clone().inv()).simplify();
        },
        subtract: function(m) {
            return this.clone().add(m.clone().neg());
        },
        inv: function() {
            var t = this.den;
            this.den = this.num;
            this.num = t;
            return this;
        },
        neg: function() {
            this.num *= -1;
            return this;
        },
        add: function(m) { 
            var n1 = this.den, n2 = m.den, c = this.clone();
            var a = Number(c.num), b = Number(m.num);
            if(n1 === n2) {
                c.num = a+b;
            }
            else {
                c.num = a*n2 + b*n1;
                c.den = n1*n2;
            }

            return c.simplify();
        },
        simplify: function() {
            var gcd = Math2.GCD(this.num, this.den);
            this.num /= gcd;
            this.den /= gcd;
            return this;
        },
        clone: function() {
            var m = new Frac();
            m.num = this.num;
            m.den = this.den;
            return m;
        },
        toDecimal: function() {
            return this.num/this.den;
        },
        equals: function(n) {
            var a = n instanceof Frac ? n.toDecimal() : n,
                b = this.toDecimal();
            return a == b; //needs falsy check
        },
        absEquals: function(n) {
            var a = n instanceof Frac ? n.toDecimal() : n,
                b = this.toDecimal();
            return a == Math.abs(b); //needs falsy check
        },
        greaterThan: function(n) {
            var a = n instanceof Frac ? n.toDecimal() : n,
                b = this.toDecimal();
            return b > a;
        },
        lessThan: function(n) { 
            var a = n instanceof Frac ? n.toDecimal() : n,
                b = this.toDecimal();
            return b < a;
        },
        isInteger: function() {
            return this.den === 1;
        },
        negate: function() {
            this.num *= -1;
            return this;
        },
        invert: function() { 
            var t = this.den;
            this.den = this.num;
            this.num = t;
            return this;
        },
        absoluteValue: function() {
            this.num = Math.abs(this.num);
            this.den = Math.abs(this.den);
            return this;
        },
        toString: function() {
            return this.den !== 1 ? this.num+'/'+this.den : String(this.num);
        },
        valueOf: function() {
            return this.num/this.den;
        }
    };
    
    /**
     * All symbols e.g. x, y, z, etc or functions are wrapped in this class. All symbols have a multiplier and a group. 
     * All symbols except for "numbers (group N)" have a power. 
     * @class Primary data type for the Parser. 
     * @param {String} obj 
     * @returns {Symbol}
     */
    function Symbol(obj) { 
        //this enables the class to be instantiated without the new operator
        if(!(this instanceof Symbol)) { return new Symbol(obj); };
        
        //define numeric symbols
        if(!isNaN(obj)) {
            this.group = N;
            this.value = CONST_HASH; 
            this.multiplier = new Frac(obj);
        }
        //define symbolic symbols
        else {
            this.group = S; 
            validateName(obj); 
            this.value = obj;
            this.toUnitMultiplier();
        }
        
        //As of 6.0.0 we switched to infinite precision so all objects have a power
        //Although this is still redundant in constants, it simplifies the logic in
        //other parts so we'll keep it
        this.toLinear();

        // Added to silence the strict warning.
        return this; 
    }
    
    Symbol.imaginary = function() {
        var s = new Symbol(Settings.IMAGINARY);
        s.isImaginary = true;
        return s;
    };
    
    Symbol.shell = function(group, value) { 
        var symbol = new Symbol(value);
        symbol.group = group;
        symbol.symbols = {};
        symbol.length = 0;
        return symbol;
    };
    
    Symbol.prototype = {
        /**
         * If the symbols is of group PL or CP it will return the multipliers of each symbol
         * as these are polynomial coefficients. CB symbols are glued together by multiplication
         * so the symbol multiplier carries the coefficients for all contained symbols.
         * For S it just returns it's own multiplier.
         * @return {Array}
         */
        coeffs: function() {
            var c = [];
            if(this.symbols) {
                for(var x in this.symbols) {
                    c.push(this.symbols[x].multiplier);
                }
            }
            else c.push(this.multiplier);
            return c;
        },
        /**
         * Checks to see if two functions are of equal value
         */
        equals: function(symbol) {
            return this.value === symbol.value && text(this.power) === text(symbol.power);
        },
        /**
         * Because nerdamer doesn't group symbols by polynomials but 
         * rather a custom grouping method, this has to be
         * reinserted in order to make use of most algorithms. This function
         * checks if the symbol meets the criteria of a polynomial.
         * @returns {boolean}
         */
        isPoly: function(include_denom, multivariate) { 
            var status = false;
            if( this.group === S && this.power > 0 || this.group === N) {
                status = true;
            }
            else {
                var k = keys( this.symbols ).sort(),
                    kl = k.length;
                 //the following assumptions are made in the next check
                 //1. numbers are represented by an underscore
                 //2. variable and function names must start with a letter
                if(kl === 2 && k[0] === CONST_HASH) { 
                    status = this.symbols[k[1]].isPoly(include_denom, multivariate);
                }
                else if(this.group === CP && multivariate) { 
                    status = true;
                    for(var x in this.symbols) {
                        var s = this.symbols[x], g = s.group; 
                        if(g === FN || g === EX) { status = false; }
                        else if(g === PL ||g === CP) { status = s.isPoly(include_denom, multivariate); }
                        if(!status) break;
                    }
                    
                }
                else if( this.group === PL ) { 
                    status = true;
                    //any random first object is fine since all member of PL are of the same type & group
                    for( var i=0; i<kl; i++ ) {
                        var p = k[i];
                        status = !isNaN(p);
                        if(!include_denom) status = !(p < 0);
                        if(!status) break;
                    }
                }
            }
            return status;
        },
        isConstant: function() {
            return this.value === CONST_HASH;
        },
        isInteger: function() {
            return this.isConstant() && this.multiplier.isInteger();
        },
        isLinear: function() {
            return this.power.equals(1);
        },
        /**
         * Checks to see if symbol is located in the denominator
         * @returns {boolean}
         */
        isInverse: function() {
            if(this.group === EX) return (this.power.multiplier < 0);
            return this.power < 0;
        },
        /**
         * Make a duplicate of a symbol by copying a predefined list of items
         * to a new symbol
         * @returns {Symbol}
         */
        clone: function() { 
            var clone = new Symbol(0),
                //list of properties excluding power as this may be a symbol and would also need to be a clone.
                properties = [
                    'value', 'group', 'length', 'previousGroup', 'isImgSymbol', 'fname', 'args'],
                l = properties.length, i;
            if(this.symbols) {
                clone.symbols = {};
                for(var x in this.symbols) {
                    clone.symbols[x] = this.symbols[x].clone();
                }
            }

            for(i=0; i<l; i++) {
                if(this[properties[i]] !== undefined) {
                    clone[properties[i]] = this[properties[i]];
                }
            }

            clone.power = this.power.clone();
            clone.multiplier = this.multiplier.clone();
            return clone;
        },
        toUnitMultiplier: function(keepSign) {
            if(keepSign) {
                this.multiplier.num /= Math.abs(this.multiplier.num);
                this.multiplier.den /= Math.abs(this.multiplier.den);
            }
            else this.multiplier = new Frac(1);
            return this;
        },
        multiplyPower: function(p2) {
            var p1 = this.power;
            
            if(isSymbol(p2)) {
                if(this.group !== EX) {
                    p1 = new Symbol(p1);
                    this.convert(EX);
                }
                this.power = _.multiply(p1, p2);
            }
            else {
                if(this.group === N && !p2.isInteger()) {
                    this.convert(P);
                    this.isRad = !p2.isInteger();
                }
                this.power = p1.equals(1) ? p2.clone() : p1.multiply(p2);
            }
            return this;
        },
        toLinear: function() {
            this.power = new Frac(1);
            return this;
        },
        each: function(fn) {
            for(var x in this.symbols) {
                fn.call(this, this.symbols[x], x);
            }
        },
        /**
         * A numeric value to be returned for Javascript. It will try to 
         * return a number as far a possible but in case of a pure symbolic
         * symbol it will just return its text representation
         * @returns {String|Number}
         */
        valueOf: function() {
            if(this.group === N) { return this.multiplier; }
            else if(this.power === 0){ return 1; }
            else if(this.multiplier === 0) { return 0; }
            else { return text(this); }
        },
        /**
         * Checks to see if a symbols has a particular variable within it.
         * Pass in true as second argument to include the power of exponentials
         * which aren't check by default.
         * @example var s = _.parse('x+y+z'); s.contains('y');
         * //returns true
         * @returns {boolean}
         */
        contains: function(variable, all) { 
            var g = this.group; 
            if(this.symbols) {
                for(var x in this.symbols) { if(this.symbols[x].contains(variable, all)) return true; }
            }
            else if(g === FN || this.previousGroup === FN) {
                for(var i=0; i<this.args.length; i++) { if(this.args[i].contains(variable, all)) return true; }
            }
            else if(g === EX) { 
                //exit only if it does
                if(all && this.power.contains(variable, all)) { return true; }
                return this.value === variable;
            }
            
            return this.value === variable;
        },
        /**
         * Negates a symbols
         * @returns {boolean}
         */
        negate: function() { 
            this.multiplier.negate();
            if(this.group === CP || this.group === PL) this.distributeMultiplier();
            return this;
        },
        /**
         * Inverts a symbol
         * @returns {boolean}
         */
        invert: function(power_only) { 
            //invert the multiplier
            if(!power_only) this.multiplier = this.multiplier.invert();
            //invert the rest
            if(isSymbol(this.power)) {
                this.power.negate();
            }
            else {
                if(this.power && this.group !== N) this.power.negate();
            }
            return this;
        },
        /**
         * Symbols of group CP or PL may have the multiplier being carried by 
         * the top level symbol at any given time e.g. 2*(x+y+z). This is 
         * convenient in many cases, however in some cases the multiplier needs
         * to be carried individually e.g. 2*x+2*y+2*z.
         * This method distributes the multiplier over the entire symbol
         * @returns {Symbol}
         */
        distributeMultiplier: function() {
            if(this.symbols && this.power.equals(1) && this.group !== CB) {
                for(var x in this.symbols) {
                    var s = this.symbols[x];
                    s.multiplier = s.multiplier.multiply(this.multiplier);
                    s.distributeMultiplier();
                }
                this.toUnitMultiplier();
            }

            return this;
        },
        /**
         * This method expands the exponent over the entire symbol just like
         * distributeMultiplier
         * @returns {Symbol}
         */
        distributeExponent: function() { 
            if(this.power !== 1) {
                var p = this.power;
                for(var x in this.symbols) {
                    var s = this.symbols[x];
                    if(s.group === EX) {
                        s.power = _.multiply(s.power, new Symbol(p));
                    }
                    else {
                        this.symbols[x].power  = this.symbols[x].power.multiply(p);
                    }
                }
                this.toLinear();
            }
            return this;
        },
        /**
         * This method will attempt to up-convert or down-convert one symbol
         * from one group to another. Not all symbols are convertible from one 
         * group to another however. In that case the symbol will remain 
         * unchanged.
         */
        convert: function(group, value) { 
            if(group > FN) { 
                //make a clone of this symbol;
                var cp = this.clone();

                //attach a symbols object and upgrade the group
                this.symbols = {};

                if(group === CB) { 
                    //symbol of group CB hold symbols bound together through multiplication
                    //because of commutativity this multiplier can technically be anywhere within the group
                    //to keep track of it however it's easier to always have the top level carry it
                    cp.toUnitMultiplier();
                }
                else {
                    //reset the symbol
                    this.toUnitMultiplier();
                }

                if(this.group === FN) {
                    cp.args = this.args; 
                    delete this.args;
                    delete this.fname;
                }

                //the symbol may originate from the symbol i but this property no longer holds true
                //after copying
                if(this.isImgSymbol) delete this.isImgSymbol;

                this.toLinear();
                //attach a clone of this symbol to the symbols object using its proper key
                this.symbols[cp.keyForGroup(group)] = cp; 
                this.group = group;
                //objects by default don't have a length property. However, in order to keep track of the number
                //of sub-symbols we have to impliment our own.
                this.length = 1;    
            }
            else if(group === EX) { 
                //1^x is just one so check and make sure
                if(!(this.group === N && this.multiplier.absEquals(1))) {
                    this.previousGroup = this.group;
                    if(this.group === N) { 
                        this.value = this.multiplier.den.toString();
                        this.toUnitMultiplier();
                    }
                    //update the hash to reflect the accurate hash
                    else this.value = text(this, 'hash');
                    
                    this.group = EX;
                }
            }
            else if(group === N) { 
                for(var x in this) {
                    if(this.hasOwnProperty(x) && (x !== 'value' && x !== 'multiplier')) delete this[x];
                }
                this.value = CONST_HASH;
                this.group = N;
            }
            else if(group === P && this.group === N) {
                if(this.multiplier.den.toString() !== '1') throw new Error('Attempting conversion of group N with non-unit denominator!');
                this.value = this.multiplier.num.toString();
                this.toUnitMultiplier();
                this.group = P;
            }
            return this;
        },
        /**
         * This method is one of the principal methods to make it all possible.
         * It performs cleanup and prep operations whenever a symbols is 
         * inserted. If the symbols results in a 1 in a CB (multiplication) 
         * group for instance it will remove the redundant symbol. Similarly
         * in a symbol of group PL or CP (symbols glued by multiplication) it
         * will remove any dangling zeroes from the symbol. It will also 
         * up-convert or down-convert a symbol if it detects that it's 
         * incorrectly grouped. It should be noted that this method is not
         * called directly but rather by the 'attach' method for addition groups
         * and the 'combine' method for multipiclation groups.
         */
        insert: function(symbol, action) { 
            //this check can be removed but saves a lot of aggravation when trying to hunt down
            //a bug. If left, you will instantly know that the error can only be between 2 symbols.
            if(!isSymbol(symbol)) err('Object '+symbol+' is not of type Symbol!');
            if(this.symbols) { 
                var group = this.group;
                if(group > FN) {
                    var key = symbol.keyForGroup(group); 
                    var existing = this.symbols[key]; //check if there's already a symbol there
                    if(action === 'add') {
                        var hash = key;

                        if(existing) { 
                            //add them together using the parser
                            this.symbols[hash] = _.add(existing, symbol); 
                            //if the addition resulted in a zero multiplier remove it
                            if(this.symbols[hash].multiplier.equals(0)) {
                                delete this.symbols[hash];
                                this.length--;
                                
                                if(this.length === 0) {
                                    this.convert(N);
                                    this.multiplier = new Frac(0);
                                }
                            }
                        }
                        else { 
                            this.symbols[key] = symbol;
                            this.length++;
                        }  
                    }
                    else { 
                        //transfer the multiplier to the upper symbol
//                        if(this.length === 0) this.group = symbol.group;
//                        else this.group = CB;
                        
                        this.multiplier = this.multiplier.multiply(symbol.multiplier);
                        symbol.toUnitMultiplier();
                        
                        if(existing) {  
                            //remove because the symbol may have changed
                            symbol = _.multiply(remove(this.symbols, key), symbol);
                            if(this.length === 0) this.convert(N);
                            this.length--;
                            //clean up
                        }
                        
                        //move the multiplier to the upper symbol
                        
                        //don't insert the symbol if it's 1
                        if(!symbol.isOne(true)) {
                            this.symbols[key] = symbol;
                            this.length++;
                        }
                        else if(symbol.multiplier.lessThan(0)) {
                             this.negate(); //put back the sign
                        }
                    }
                    
                    //update the hash
                    if(this.group === CP || this.group === CB) {
                        this.updateHash();
                    }
                   
                }
            }

            return this;
        },  
        //the insert method for addition
        attach: function(symbol) {
            if(isArray(symbol)) {
                for(var i=0; i<symbol.length; i++) this.insert(symbol[i], 'add');
                return this;
            }
            return this.insert(symbol, 'add');
        },
        //the insert method for multiplication
        combine: function(symbol) {
            if(isArray(symbol)) {
                for(var i=0; i<symbol.length; i++) this.insert(symbol[i], 'multiply');
                return this;
            }
            return this.insert(symbol, 'multiply');
        },
        /**
         * This method should be called after any major "surgery" on a symbol.
         * It updates the hash of the symbol for example if the fname of a 
         * function has changed it will update the hash of the symbol.
         */
        updateHash: function() {
            if(this.group === FN) {
                var contents = '',
                    args = this.args,
                    is_parens = this.fname === PARENTHESIS;
                for(var i=0; i<args.length; i++) contents += (i===0 ? '' : ',')+text(args[i]);
                var fn_name = is_parens ? '' : this.fname;
                this.value = fn_name+(is_parens ? contents : inBrackets(contents));
            }
            else if(!(this.group === S || this.group === PL)) {
                this.value = text(this, 'hash');
            }
        },
        /**
         * this function defines how every group in stored within a group of 
         * higher order think of it as the switchboard for the library. It 
         * defines the hashes for symbols. 
         */
        keyForGroup: function(group, suggest) {
            var g = this.group;
            if(g === N) {
                return this.value;
            }
            else if(g === S || g === P) {
                if(group === PL) return this.power.toDecimal();
                else return this.value;
            }
            else if(g === FN) {
                if(group === PL) return this.power.toDecimal();
                return text(this, 'hash');
            }
            else if(g === PL) { 
                //if the order is reversed then we'll assume multiplication
                //TODO: possible future dilemma
                if(group === CB) return text(this, 'hash');
                if(group === CP) { 
//                    throw new Error()
                    var key;
                    if(this.power.equals(1)) key = this.value;
                    else key = inBrackets(text(this, 'hash'))+'^'+this.power.toDecimal();
                }
                else if(group === PL) key = this.power.toString();
                else key = this.value;
                return key;
            }
            else if(g === CP) {
                if(group === CP) return text(this, 'hash');
                if(group === PL) return this.power.toDecimal();
                return this.value;
            }
            else if(g === CB) {
                if(group === PL) return this.power.toDecimal();
                return text(this, 'hash');
            }
            else if(g === EX) { 
                if(group === PL) return text(this.power);
                return text(this, 'hash');
            }
        },
        /** 
         * Symbols are typically stored in an object which works fine for most
         * cases but presents a problem when the order of the symbols makes
         * a difference. This function simply collects all the symbols and 
         * returns them as an array. If a function is supplied then that 
         * function is called on every symbol contained within the object.
         * @returns {Array}
         */
        collectSymbols: function(fn) { 
            var collected = [];
            for(var x in this.symbols) {
                var symbol = this.symbols[x];
                collected.push( fn ? fn(symbol) : symbol );
            }
            return collected.sort();//sort hopefully gives us some sort of consistency
        },
        /**
         * Returns the latex representation of the symbol
         * @returns {String}
         */
        latex: function() {
            return Latex.latex(this);
        },
        /**
         * Returns the text representation of a symbol
         * @returns {String}
         */
        text: function() {
            return text(this);
        },
        /**
         * Checks if the function evaluates to 1. e.g. x^0 or 1 :)
         */
        isOne: function(abs) {
            var f = abs ? 'absEquals' : 'equals';
            if(this.group === N) return this.multiplier[f](1);
            else return this.power.equals(0);
        },
        isComposite: function() {
            var g = this.group,
                pg = this.previousGroup;
            return g === CP || g === PL || pg === PL || pg === CP;
        },
        /**
         * Get's the denominator of the symbol if the symbol is of class CB (multiplication)
         * with other classes the symbol is either the denominator or not. 
         * Take x^-1+x^-2. If the symbol was to be mixed such as x+x^-2 then the symbol doesn't have have an exclusive
         * denominator and has to be found by looking at the actual symbols themselves.
         */
        getDenom: function() {
            if(this.group === CB) {
                for(var x in this.symbols) {
                    if(this.symbols[x].power < 0) return this.symbols[x];
                }
            }
        },
        toString: function() {
            return this.text();
        }
    };
    
    //EXPERIMENTAL -  Might be stripped
    function Equation(equation1, equation2) {
        this.e1 = equation1;
        this.e2 = equation2;
    }
    
    /**
     * This class defines the operators in nerdamer. The thinking is that with using these parameters
     * we should be able to define more operators such as the modulus operator or a boolean operator.
     * Although this initially works at the moment, it fails in some instances due to minor flaws in design which
     * will be addressed in future releases.
     * @param {char} val - The symbol of the operator
     * @param {String} fn - The function it maps to
     * @param {Integer} precedence - The precedence of the operator
     * @param {boolean} left_assoc - Is the operator left or right associative
     * @param {boolean} is_prefix - Is the operator a prefix operator
     * @param {boolean} is_postfix - Is the operator a postfix operator (for future releases)
     * @returns {Operator}
     */
    function Operator(val, fn, precedence, left_assoc, is_prefix, is_postfix) {
        this.val = val;
        this.fn = fn;
        this.precedence = precedence;
        this.left_assoc = left_assoc;
        this.is_prefix = is_prefix;
        this.is_postfix = is_postfix || false;
    }
    

    /**
     * 
     * @param {char} val - The operator
     * @returns {Prefix}
     */
    function Prefix(val) {
        this.val = val;
    }
    
    Prefix.prototype = {
        /**
         * This function resolves the prefix. It will correct the sign of the symbol by changing the sign of
         * the multiplier. If the multiplier is negative it will make it positive etc..
         * @returns {Symbol}
         */
        resolve: function(obj) {
            if(this.val === '-') {
                return obj.negate();
            }
            return obj;
        }
    };

    //Uses modified Shunting-yard algorithm. http://en.wikipedia.org/wiki/Shunting-yard_algorithm
    function Parser(){
        //we want the underscore to point to this parser not the global nerdamer parser.
        var _ = this, 
            bin = {},
            constants = this.constants = {
                PI: Math.PI,
                E:  Math.E
            };
        //list all the supported operators
        var operators = {
                '^': new Operator('^', 'pow', 4, false, false),
                '*': new Operator('*', 'multiply', 3, true, false),
                '/': new Operator('/', 'divide', 3, true, false),
                '+': new Operator('+', 'add', 2, true, true),
                '-': new Operator('-', 'subtract', 2, true, true),
                ',': new Operator(',', 'comma', 1, true, false)
            },

            // Supported functions.
            // Format: function_name: [mapped_function, number_of_parameters]
            functions = this.functions = {
                'cos'       : [ , 1],
                'sin'       : [ , 1],
                'tan'       : [ , 1],
                'sec'       : [ , 1],
                'csc'       : [ , 1],
                'cot'       : [ , 1],
                'acos'      : [ , 1],
                'asin'      : [ , 1],
                'atan'      : [ , 1],
                'exp'       : [ , 1],
                'min'       : [ , -1],
                'max'       : [ ,-1],
                'erf'       : [ , 1],
                'floor'     : [ ,1],
                'ceil'      : [ ,1],
                'fact'      : [ , 1],
                'round'     : [ , 1],
                'mod'       : [ , 2],
                'vector'    : [vector, -1],
                'matrix'    : [matrix, -1],
                'parens'    : [parens, -1],
                'sqrt'      : [sqrt, 1],
                'log'       : [log , 1],
                'abs'       : [abs , 1],
                'invert'    : [invert, 1],
                'transpose' : [transpose, 1],
                'dot'       : [dot, 2]
            };
        
        var brackets = {}, //the storage container for the brackets

            last_item_on = function(stack) {
                return stack[stack.length-1];
            };
        
        var LEFT_PAREN = '(',
            RIGHT_PAREN = ')',
            LEFT_SQUARE_BRACKET = '[',
            RIGHT_SQUARE_BRACKET = ']',
            scientific_numbers = [];
                
            brackets[LEFT_PAREN] = LEFT_PAREN,
            brackets[RIGHT_PAREN] = RIGHT_PAREN,
            brackets[LEFT_SQUARE_BRACKET] = LEFT_SQUARE_BRACKET,
            brackets[RIGHT_SQUARE_BRACKET] = RIGHT_SQUARE_BRACKET;

        this.error = err;
        
        /**
         * This method gives the ability to override operators with new methods.
         * @param {String} which
         * @param {Function} with_what
         */
        this.override = function(which, with_what) {
            if(!bin[which]) bin[which] = [];
            bin[which].push(this[which]);
            this[which] = with_what;
        };
        
        /**
         * Restores a previously overridden operator
         * @param {String} what
         */
        this.restore = function(what) {
            if(this[what]) this[what] = bin[what].pop();
        };
        
        /**
         * This method is supposed to behave similarly to the override method but it does not override
         * the existing function rather it only extends it
         * @param {String} what
         * @param {Function} with_what
         * @param {boolean} force_call
         */
        this.extend = function(what, with_what, force_call) {
            var _ = this,
                extended = this[what];
            if(typeof extended === 'function' && typeof with_what === 'function') {
                var f = this[what];
                this[what] = function(a, b) {
                    if(isSymbol(a) && isSymbol(b) && !force_call) return f.call(_, a, b);
                    else return with_what.call(_, a, b, f);
                };
            }
        };
        
        /**
         * Generates library's representation of a function. It's a fancy way of saying a symbol with 
         * a few extras. The most important thing is that that it gives a fname and 
         * an args property to the symbols in addition to changing its group to FN
         * @param {String} fn_name
         * @param {Array} params
         * @returns {Symbol}
         */
        this.symfunction = function(fn_name, params) { 
            //call the proper function and return the result;
            var f = new Symbol(fn_name);
            f.group = FN;
            if(typeof params === 'object') params = [].slice.call(params);//ensure an array
            
            f.args = params;
            f.fname = fn_name;
            f.updateHash();
            return f;
        };
        
        /**
         * An internal function call for the Parser. This will either trigger a real 
         * function call if it can do so or just return a symbolic representation of the 
         * function using symfunction.
         * @param {String} fn_name
         * @param {Array} args
         * @returns {Symbol}
         */
        this.callfunction = function(fn_name, args) { 
            var fn_settings = functions[fn_name];
            
            if(!fn_settings) throw new Error(fn_name+' is not a supported function.');
            
            var num_allowed_args = fn_settings[1],
                fn = fn_settings[0],
                retval;

            if(!(args instanceof Array)) args = args !== undefined ?  [args] : [];

            if(num_allowed_args !== -1) {
                var is_array = isArray(num_allowed_args),
                    min_args = is_array ? num_allowed_args[0] : num_allowed_args,
                    max_args = is_array ? num_allowed_args[1] : num_allowed_args,
                    num_args = args.length;
            
                var error_msg = fn_name+' requires a {0} of {1} arguments. {2} provided!';
                
                if(num_args < min_args) err(format(error_msg, 'minimum', min_args, num_args));
                if(num_args > max_args) err(format(error_msg, 'maximum', max_args, num_args));
            }
            
            if(fn) { retval = fn.apply(fn_settings[2] || this, args); }
            else {
                if(Settings.PARSE2NUMBER) {
                    try { 
                        args = args.map(function(symbol) { 
                            if(symbol.group === N) return symbol.multiplier.toDecimal();
                            else err('Symbol must be of group N.');
                        });
                        var f = Math[fn_name] ? Math[fn_name] : Math2[fn_name];
                        retval = new Symbol(f.apply(undefined, args));
                    }
                    catch(e){ 
                        retval = this.symfunction(fn_name, args); 
                    }
                }
                else {
                    retval = this.symfunction(fn_name, args);
                }
            }
            return retval;
        };
        
//        this.powerAdd = function(symbol, value, thisIsEX) {
//            var isNumeric = !isNaN(value);
//            if(!isNumeric || thisIsEX || isSymbol(symbol.power)) {
//                var p = !isSymbol(value) ? new Symbol(value) : value;
//                symbol.power = _.add(symbol.power, p);
//            }
//            else {
//                symbol.power = symbol.power.add(value);
//            }
//            
//            if(symbol.power.valueOf() === 0) symbol.convert(N);
//        };
        
        /**
         * This is the method that triggers the parsing of the string. It generates a parse tree but processes 
         * it right away. The operator functions are called when their respective operators are reached. For instance
         * + with cause this.add to be called with the left and right hand values. It works by walking along each 
         * character of the string and placing the operators on the stack and values on the output. When an operator
         * having a lower order than the last is reached then the stack is processed from the last operator on the 
         * stack.
         * @param {String} expression_string
         * @param {Object} substitutions
         * @returns {Symbol}
         */
        this.parse = function(expression_string, substitutions) {  
            //Replace n! to fact(n!)
            expression_string = insertFactorial(expression_string);
            /*
             * Since variables cannot start with a number, the assumption is made that when this occurs the
             * user intents for this to be a coefficient. The multiplication symbol in then added. The same goes for 
             * a side-by-side close and open parenthesis
             */
            expression_string = String(expression_string).split(' ').join('')//strip empty spaces
                    .replace(/\d*\.*\d+e[\+\-]*\d+/gi, function(match, start, str) {
                        if(/[a-z_]/.test(str.charAt(start-1))) return match;
                        scientific_numbers.push(match);
                        return '&';
                    })
                    //allow omission of multiplication after coefficients
                    .replace(/([\+\-\/\*]*[0-9]+)([a-z_]+[\+\-\/\*]*)/gi, function() {
                        var str = arguments[4],
                            group1 = arguments[1],
                            group2 = arguments[2],
                            start = arguments[3],
                            first = str.charAt(start),
                            before = '',
                            d = '*';
                        if(!first.match(/[\+\-\/\*]/)) before = str.charAt(start-1);
                        if(before.match(/[a-z]/i)) d = '';
                        return group1+d+group2;
                    })
                    //allow omission of multiplication sign between brackets
                    .replace( /\)\(/g, ')*(' );

            var subs = substitutions || {},
                stack = [], //the operator stack
                output = [], //the values stack
                len = expression_string.length,
                pos = 0,
                last_opr_pos, //where the last operator was found
                last_operator, //the lst operator that was found
                last_char,
                EOT = false, //was the end of the string reached?
                func_on_stack = false,
                curpos = 0, //the current position on the string
                                
                evaluate = function(operator) { 
                    if(!operator) {
                        operator = stack.pop();
                    }

                    var symbol2 = output.pop(),
                        symbol1 = output.pop();

                    if(!operator && !symbol1 && symbol2) { 
                        insert(symbol2);
                    }
                    else if(operator === LEFT_PAREN) { 
                        if(EOT) err('Unmatched open parenthesis!');
                        stack.push(operator);
                        insert(symbol1);
                        insert(symbol2);
                    }
                    else {
                        var ofn = operator.fn, result;

                        //first we assume that it's the first operator in which case it's the first symbol and negative
                        if(!ofn) {
                            
                            result = operator.resolve(symbol2);
                            //let's just do a down and dirty reduction of the prefixes by looping through one at a time 
                            //and eliminating them
                            while(symbol1 && last_item_on(stack) instanceof Prefix) {
                                result = stack.pop().resolve(result);
                            }
                            //if we didn't have a first symbol then we're dealing with a pure prefix operator
                            //otherwise we need to place symbol1 back on the stack for reconsideration
                            if(symbol1) insert(symbol1);
                        }
                        else {
                            result = _[ofn].call(_, symbol1, symbol2);
                        }

                        insert(result);
                    }    
                },
                /**
                 * This method inserts the token into the output stack. Here it will attempt to detect if a prefix is 
                 * on the stack and will try to resolve it. Additonally it checks if the item is a scientific number
                 * and if so places the correct number on the output stack. 
                 * @param token
                 */
                insert = function(token) { 
                    //if the number is a scientifc number then use that instead
                    if(/&/.test(token)) {
                        token = scientific_numbers.shift();
                    }
                    
                    //when two operators are close to each other then the token will be empty or when we've gone
                    //out of range inside of the output or stack. We have to make sure the token even exists 
                    //before entering.
                    if(token !== '' && token !== undefined) { 
                        //this could be function parameters or a vector
                        if(!(token instanceof Array)) { 
                            //TODO: possible redundant check. Needs investigation
                            if(!(token instanceof Symbol) && !(customType(token))) {
                                var sub = subs[token] || VARS[token]; //handle substitutions
                                token = sub ? sub.clone() : new Symbol(token);
                            }
                        }
                        
                        //TODO: fix element index access
                        var loi = last_item_on(output);
                        
                        if(isVector(token)) {
                            var lios = last_item_on(stack);
                            if(isVector(loi)) {
                                if(!lios || lios.val !== ',') {
                                    if(token.elements.length > 2) err('Incorrect number of indices!');
                                    //swap the last item on output with the indexed element
                                    output.pop();
                                    var start = token.elements[0]-1;
                                    var end = token.elements[1];
                                    if(end !== undefined) token = new Vector(loi.elements.slice(start, end));
                                    else token = (loi.elements[start]); //make 1 the first index
                                    if(!token) err('Index out of range!');
                                }
                            }
                            else if(!lios && loi) err(loi+' is not a vector');                            
                        }
                        
                        //resolve prefixes
                        while(last_item_on(stack) instanceof Prefix) {
                            //if there's a function on the output stack then check the next operator 
                            if(func_on_stack) {
                                //check the next operator to come
                                var next_operator = operators[expression_string.charAt(curpos+1)];
                                if(next_operator && !next_operator.left_assoc) break;
                            }
                            if(operator && !operator.left_assoc) break; //don't touch pow
                            var prefix = stack.pop();
                            token = prefix.resolve(token);
                        }
                        
                        output.push(token);
                        
                        func_on_stack = false;//thank you for your service
                    } 
                };
                
            if(!subs['~']) {   
                //collect the substitutions
                for(var x in constants) subs[x] = new Symbol(constants[x]);
            }
            
            for(curpos=0; curpos<len; curpos++) { 
                var cur_char = expression_string.charAt(curpos);
                var operator = operators[cur_char], //a possible operator
                    bracket = brackets[cur_char]; //a possible bracket
                //if the character is a bracket or an operator but not a scientific number
                if(operator || bracket) {
                    //if an operator is found then we assume that the preceeding is a variable.
                    //the token has to be from the last position up to the current position
                    var token = expression_string.substring(pos,curpos); 

                    if(bracket === LEFT_PAREN && token || bracket === LEFT_SQUARE_BRACKET) {
                        //make sure you insert the variables
                        if(bracket === LEFT_SQUARE_BRACKET && token) insert(token);
                        
                        var f = bracket === LEFT_SQUARE_BRACKET ? VECTOR : token;
                        stack.push(new Func(f), LEFT_PAREN);
                        pos = curpos+1;
                        last_opr_pos = curpos; 
                        continue;
                    }
                    //place the token on the output stack. 
                    //This may be empty if we're at a unary or bracket so skip those.
                    insert(token);

                    //if the preceding token is a operator
                    if(!bracket && (curpos-last_opr_pos === 1 || curpos === 0)) { 
                        if(operator.is_prefix) {
                            stack.push(new Prefix(operator.val));
                            pos = curpos+1;
                            last_opr_pos = curpos;
                            continue;
                        }
                        err(operator.val+' is not a valid prefix operator!:'+pos); 
                    }
                    //note that open brackets count as operators in this case
                    if(cur_char !== RIGHT_PAREN) last_opr_pos = curpos; 

                    if(operator) { 
                        //we may be at the first operator, in which case the last operator may be undefined
                        //If this is the case then do nothing other than record the last operator and 
                        //place the operator on the stack.
                        if(last_operator) { 
                            if(operator.left_assoc && operator.precedence <= last_operator.precedence ||
                                    !operator.left_assoc && (operator.precedence < last_operator.precedence)) {
                                var done = false;
                                do {
                                    evaluate(); 
                                    var last = last_item_on(stack); 
                                    //stop when you see a parethesis
                                    if(last === LEFT_PAREN) break;
                                    
                                    done = last ? last.left_assoc && last.precedence < operator.precedence: true;
                                }
                                while(!done);  
                            }
                        }
                        stack.push(operator);
                        last_operator = last_item_on(stack);
                    }
                    else { 
                        if(cur_char === LEFT_PAREN) {
                            stack.push(bracket);
                        }
                        else if(cur_char === RIGHT_PAREN || cur_char === RIGHT_SQUARE_BRACKET) { 
                            last_opr_pos = null;
                            var found_matching = false;
                            while(!found_matching) {
                                var popped = stack.pop();
                                
                                if(popped === undefined) err('Unmatched close bracket or parenthesis!');

                                if(popped === LEFT_PAREN) {
                                    found_matching = true;
                                }
                                else evaluate(popped);
                                //TODO: fix bracket parity checking.
                                if(popped === LEFT_PAREN && cur_char === RIGHT_SQUARE_BRACKET) {
                                    var lsi = last_item_on(stack);
                                    if(!lsi || lsi.name !== VECTOR) err('Unmatched parenthesis!');
                                }
                            }
                            
                            var last_stack_item = last_item_on(stack);

                            if(last_stack_item instanceof Func) { 
                                //TODO: fix bracket parity checking
                                if(last_stack_item.name === VECTOR && cur_char !== RIGHT_SQUARE_BRACKET)
                                    err('Unmatched bracket!');
                                var v = _.callfunction(stack.pop().name, output.pop()); 
                                func_on_stack = true;
                                insert(v);//go directly to output as this will cause the prefix to prematurely be evaluated
                            }
                        }
                        last_operator = last_item_on(stack);
                    } 
                    
                    pos = curpos+1; //move along
                }
                else if(curpos === len-1) {
                    insert(expression_string.substring(pos, curpos+1));
                }
                last_char = cur_char;
            }
            
            EOT = true; //end of tokens/stack reached
            
            while(stack.length > 0) { 
                evaluate();
            }

            return output[0];
        };

        //FUNCTIONS
        //although parens is not a "real" function it is important in some cases when the 
        //symbol must carry parenthesis. Once set you don't have to worry about it anymore
        //as the parser will get rid of it at the first opportunity
        function parens(symbol) {
            if(Settings.PARSE2NUMBER) {
                return symbol;
            }
            return _.symfunction('parens', [symbol]);
        }
        
        function abs(symbol) {
            if(symbol.multiplier.lessThan(0)) symbol.multiplier.negate();
            if(isNumericSymbol(symbol) || even(symbol.power)) {
                return symbol;
            }
            return _.symfunction(ABS, [symbol]);
        }
        
        /**
         * It just raises the symbol's power to 1/2
         * @param {Symbol} symbol
         * @returns {Symbol}
         */
        function sqrt(symbol) { 
            var img, retval, 
                isConstant = symbol.isConstant();

            //if the symbol is already sqrt then it's that symbol^(1/4) and we can unwrap it
            if(symbol.fname === SQRT) { 
                var s = symbol.args[0];
                s.power = symbol.power.multiply(new Frac(0.25));
                retval = s;
            }
            //if the symbol is a fraction then we don't keep can unwrap it. For instance
            //no need to keep sqrt(x^(1/3))
            else if(!symbol.power.isInteger()) { 
                symbol.power = symbol.power.multiply(new Frac(0.5));
                retval = symbol;
            }
            else { 
                //if the symbols is imagary then we place in the imaginary part. We'll return it 
                //as a product
                if(isConstant && symbol.multiplier.lessThan(0)) {
                    img = Symbol.imaginary();
                    symbol.multiplier = symbol.multiplier.absoluteValue();
                }
                
                var q = symbol.multiplier.toDecimal(),
                    qa = Math.abs(q),
                    t = Math.sqrt(qa);
           
                
                var m;
                //it's a perfect square so take the square
                if(isInt(t)) {
                    m = new Symbol(t);
                }
                else if(isInt(q)) { 
                    m = _.symfunction(SQRT, [new Symbol(q)]);
                }
                else {
                    var n = symbol.multiplier.num.toString(),
                        d = symbol.multiplier.den.toString();
                    m = _.multiply(
                            n === '1' ? new Symbol(1) : _.symfunction(SQRT, [new Symbol(n)]), 
                            d === '1' ? new Symbol(1) : _.symfunction(SQRT, [new Symbol(d)]).invert()
                    );
                }

                
                //strip the multiplier since we already took the sqrt
                symbol = symbol.toUnitMultiplier(true);
                //if the symbol is one just return one and not the sqrt function
                if(symbol.isOne()) {
                    retval = symbol;
                }
                else if(even(symbol.power.toString())) { 
                    //just raise it to the 1/2
                    retval = _.pow(symbol.clone(), new Symbol(0.5));
                    
                    var p = retval.power.toString();
                    //preserve the absolute value
                    if(!even(p)) { 
                        var s = retval.clone().toLinear();

                        if(p !== '1') {
                            retval.power = retval.power.subtract(new Frac(1));
                        }
                        else retval = new Symbol(1);
                        
                        retval = _.multiply(retval, _.symfunction(ABS, [s]));
                    }
                }
                else { 
                    retval = _.symfunction(SQRT, [symbol]);
                }
//                var retval = symbol.isOne() ? symbol : _.symfunction(SQRT, [symbol]);
                //we've taken the sqrt of the multiplier so return it to the symbol
                if(m) retval = _.multiply(m, retval);

                if(img) retval = _.multiply(img, retval);
            }

            return retval;
        }
        
        function log(symbol) { 
            var retval;
            if(symbol.group === FN && symbol.fname === 'exp') {
                var s = symbol.args[0];
                if(symbol.multiplier.equals(1)) retval = _.multiply(s, new Symbol(symbol.power));
                else retval = _.symfunction('log',[symbol]);
            }
            else if(Settings.PARSE2NUMBER && isNumericSymbol(symbol)) {
                var img_part;
                if(symbol.multiplier.lessThan(0)) {
                    symbol.negate();
                    img_part = _.multiply(new Symbol(Math.PI), new Symbol('i'));
                }
                retval = new Symbol(Math.log(symbol.multiplier));
                if(img_part) retval = _.add(retval, img_part);
            }
            else {
                retval = _.symfunction('log', arguments); 
            }
            return retval;
        }
        
        //the constructor for vectors
        function vector() {
            return new Vector([].slice.call(arguments));
        }
        
        //the constructor for matrices
        function matrix() {
            return Matrix.fromArray(arguments);
        }
        
        function determinant(symbol) {
            if(isMatrix(symbol)) {
                return symbol.determinant();
            }
            return symbol;
        }
        
        function dot(vec1, vec2) {
            if(isVector(vec1) && isVector(vec2)) return vec1.dot(vec2);
            err('function dot expects 2 vectors');
        }
        
        function transpose(mat) {
            if(isMatrix(mat)) return mat.transpose();
            err('function transpose expects a matrix');
        }
        
        function invert(mat) {
            if(isMatrix(mat)) return mat.invert();
            err('invert expects a matrix');
        }
        
        //extended functions. Because functions like log aren't directly 
        //stored in an object, it's difficult to find out about them unless you know of them 
        //outside of the library. This serves as registry. That's all.
        this.ext = {
            log: log,
            sqrt: sqrt,
            abs: abs,
            vector: vector,
            matrix: matrix,
            parens: parens,
            determinant: determinant,
            dot: dot,
            invert: invert,
            transpose: transpose
        };
        
        //The loader for functions which are not part of Math2
        this.mapped_function = function() { 
            var subs = {},
                params = this.params;
            for(var i=0; i<params.length; i++) subs[params[i]] = arguments[i];
            return _.parse(this.body, subs);
        };
        
        //the simpler the structure of the symbol, the better. Unpack tries to
        //remove the parens function and return it in a simpler form.
        this.unpack = function(symbol) { 
            //we only touch this bad boy if the power is one 
            if(symbol.power.equals(1)) {
                //parens should only carry one symbol
                var unpacked = symbol.args[0];
                unpacked.multiplier.multiply(symbol.multiplier);
                symbol = unpacked;
            }
            return symbol;
        };

        //
        /**
         * Adds two symbols
         * @param {Symbol} a
         * @param {Symbol} b
         * @returns {Symbol}
         */
        this.add = function(a, b) { 
            var g1 = a.group,
                g2 = b.group,
                ap = a.power.toString(),
                bp = b.power.toString();
            //always keep the greater group on the left. 
            if(g1 < g2 || (g1 === g2 && ap > bp)) return this.add(b, a);
            
            var powEQ = ap === bp,
                v1 = a.value,
                v2 = b.value,
                h1, h2, result;
            
            if(a.isComposite()) h1 = text(a, 'hash');
            if(b.isComposite()) h2 = text(b, 'hash');
            
            //PL & PL should compare hashes and not values e.g. compare x+x^2 with x+x^3 and not x with x
            if(g1 === PL && g2 === PL) { 
                v1 = h1; v2 = h2;
            }
            
            var PN = g1 === P && g2 === N,
                PNEQ = a.value === b.multiplier.toString(),
                valEQ = (v1 === v2 || h1 === h2 && !h1 === undefined || (PN && PNEQ));
        
            //equal values, equal powers
            if(valEQ && powEQ) { 
                //make sure to convert N to something P can work with
                if(PN) b = b.convert(P);//CL
                
                //handle PL
                if(g1 === PL && (g2 === S || g2 === P)) {
                    a.distributeMultiplier();
                    result = a.attach(b);
                }
                else {
                    result = a;//CL
                    result.multiplier = result.multiplier.add(b.multiplier);
                }
            }
            //equal values uneven powers
            else if(valEQ) {
                result = Symbol.shell(PL).attach([a, b]);
                //update the hash
                result.value = g1 === PL ? h1 : v1;
            }
            else if(a.isComposite() && a.isLinear()) { 
                var canIterate = g1 === g2,
                    bothPL = g1 === PL && g2 === PL; 

                //we can only iterate group PL if they values match
                if(bothPL) canIterate = a.value === b.value;
                //distribute the multiplier over the entire symbol
                a.distributeMultiplier();
                
                if(b.isComposite() && b.isLinear() && canIterate) {
                    b.distributeMultiplier();
                    //CL
                    b.each(function(x) {
                        a.attach(x);
                    });
                    result = a; 
                }
                else if(g1 === CP) {
                    result = a.attach(b);
                }
                else { 
                    if(bothPL && a.contains(h2)) result = a.attach(b);
                    else result = Symbol.shell(CP).attach([a, b]);
                }
            }
            else { 
                result = Symbol.shell(CP).attach([a, b]);
                result.updateHash();
            }
            
            if(result.multiplier.equals(0)) result = new Symbol(0);

            return result;
        };
        
        /**
         * Gets called when the parser finds the - operator. Not the prefix operator. See this.add
         * @param {Symbol} symbol1
         * @param {Symbol} symbol2
         * @returns {Symbol}
         */
        this.subtract = function( symbol1, symbol2) { 
            var isSymbolA = isSymbolA = isSymbol(symbol1), isSymbolB = isSymbol(symbol2), t;
            
            if(isSymbolA && isSymbolB) return this.add(symbol1, symbol2.negate());
            
            if(isSymbolB) {
                t = symbol2; symbol2 = symbol1; symbol1 = t;
                isSymbolA = isSymbolB;
            }
            if(isSymbolA && isVector(symbol2)) {
                symbol2 = symbol2.map(function(x) {
                    return _.subtract(x, symbol1.clone());
                });
            }
            else if(isVector(symbol1) && isVector(symbol2)) {
                if(symbol1.dimensions() === symbol2.dimensions()) symbol2 = symbol1.subtract(symbol2);
                else _.error('Unable to subtract vectors. Dimensions do not match.');
            }
            else if(isMatrix(symbol1) && isMatrix(symbol2)) {
                var rows = symbol1.rows();
                if(rows === symbol2.rows() && symbol1.cols() === symbol2.cols()) {
                    symbol2.eachElement(function(x, i, j) {
                        return _.subtract(x, symbol1.elements[i][j]);
                    });
                }
                else _.error('Matrix dimensions do not match!');
            }
            return symbol2;
        };

        /**
         * Gets called when the parser finds the * operator. See this.add
         * @param {Symbol} a
         * @param {Symbol} b
         * @returns {Symbol}
         */
        this.multiply = function(a, b) { 
            //don't waste time
            if(a.isOne()) return b.clone();
            if(b.isOne()) return a.clone();

            if(a.multiplier.equals(0) || b.multiplier.equals(0)) return new Symbol(0);
            
            var g1 = a.group,
                g2 = b.group;
            
            if(g2 > g1 && !(g2 === CP)) return this.multiply(b, a);

            var v1 = a.value,
                v2 = b.value,
                //since P is just a morphed version of N we need to see if they relate
                ONN = (g1 === P && g2 === N && b.multiplier.equals(a.value)),
                //don't multiply the multiplier of b since that's equal to the value of a
                m = ONN ? new Frac(1).multiply(a.multiplier) : a.multiplier.multiply(b.multiplier),
                result = a.clone().toUnitMultiplier();
            
            //same issue with (x^2+1)^x*(x^2+1)
            //EX needs an exception when multiplying because it needs to recognize
            //that (x+x^2)^x has the same hash as (x+x^2). The latter is kept as x
            if(g2 === EX && b.previousGroup === PL && g1 === PL) {
                v1 = text(a, 'hash', EX);
            }
            
            if(v1 === v2 || ONN) { 
                var p1 = a.power,
                    p2 = b.power,
                    isSymbolP1 = isSymbol(p1),
                    isSymbolP2 = isSymbol(p2),
                    toEX = (isSymbolP1 || isSymbolP2);
                //add the powers
                result.power = toEX ? _.add(
                    !(isSymbol(p1)) ? new Symbol(p1) : p1, 
                    !(isSymbol(p2)) ? new Symbol(p2) : p2
                ): (g1 === N /*don't add powers for N*/? p1 : p1.add(p2));
        
                //properly convert to EX
                if(toEX) result.convert(EX);
            }
            else if(g1 === CB && a.isLinear()){ 
                if(g2 === CB && b.isLinear()) { 
                    b.each(function(x) {
                        result = result.combine(x);
                    });
                }
                else {
                    result.combine(b);
                }
            }
            else {
                //the multiplier was already handled so nothing left to do
                if(g1 !== N) { 
                    result = Symbol.shell(CB).combine([result, b]);
                }     
                else { 
                    result = b.clone().toUnitMultiplier();
                }
            }
            
            //unpack CB if length is only one
            if(result.length === 1) {
                //transfer the multiplier
                var s = firstObject(result.symbols);
                s.multiplier = s.multiplier.multiply(result.multiplier);
                result = s;
            }
            
            //reduce square root
            var ps = result.power.toString(); 
            if(even(ps) && result.fname === SQRT) { 
                var p = result.power;
                result = result.args[0]; 
                result = _.multiply(new Symbol(m), _.pow(result, new Symbol(p.divide(new Frac(2)))));
            }
            else result.multiplier = m;

            if(result.group === N && result.power > 1) throw new Error('damn')
            return result;
        };
        
        /**
         * Gets called when the parser finds the / operator. See this.add
         * @param {Symbol} symbol1
         * @param {Symbol} symbol2
         * @returns {Symbol}
         */
        this.divide = function(a, b) {
            var result;
            if(a.isConstant() && b.isConstant()) {
                result = a.clone();
                result.multiplier = result.multiplier.divide(b.multiplier);
            }
            else {
                b.invert();
                result = _.multiply(a, b);
            }
            return result;
        };

        /**
         * Gets called when the parser finds the ^ operator. See this.add
         * @param {Symbol} a
         * @param {Symbol} b
         * @returns {Symbol}
         */
        this.pow = function(a, b) { 
            var bIsInt = bIsInt = b.isInteger();
            
            //quick conversion for P. Don't waste time;
            if(a.isInteger() && !bIsInt && b.isConstant()) {
                a.convert(P);
            }
                
            var n = a.multiplier.num.toString(),
                d = a.multiplier.den.toString(),
                result;
        
            if(!bIsInt) {
                var nsym, dsym;
                //1^n = 1 so nsym is always 1
                nsym = n === '1' ? new Symbol(1) :  _.pow(new Symbol(n), b.clone()); 
                if(d !== '1') dsym = _.pow(new Symbol(d), b.clone());
                result = nsym && dsym ? _.multiply(nsym, dsym.invert()) : nsym;
            }
            
            if(b.isConstant()) { 
                if(bIsInt) {
                    var p = b.toString(),
                        np = Math.pow(n, p),
                        dp = Math.pow(d, p);
                    result = _.multiply(new Symbol(np), new Symbol(dp).invert());
                }

                if(!a.isConstant()) { 
                    var s = a.clone().toUnitMultiplier();
                    s.power = s.power.multiply(b.multiplier.clone());
                    result = _.multiply(result, s);
                    if(result.group === P && result.power.isInteger()) {
                        result = _.pow(new Symbol(result.value), new Symbol(result.power));
                    }
                }
            }
            else {
                if(!a.isConstant()) {
                    var t = a.clone().toUnitMultiplier();
                    t.convert(EX);
                    t.power = b.clone();
                    result = _.multiply(result, t);
                }
            }

            //wrap the symbol in sqrt. This eliminates one more check down the line.
            if(!isSymbol(result.power) && result.power.equals(0.5)) { 
                //don't devide the power directly. Notice the use of toString. This makes it possible
                //to use a bigNumber library in the future
                result = sqrt(result.toLinear());
            }
            
            //reduce square root
            if(result.fname === SQRT) { 
                var isEX = result.group === EX;
                var t = isEX ? result.power.multiplier.toString() : result.power.toString();
                if(even(t)) { 
                    var pt = isEX ? _.divide(result.power, new Symbol(2)) : new Symbol(result.power.divide(new Frac(2))),
                        m = result.multiplier;
                    result = _.pow(result.args[0], pt);
                    result.multiplier = result.multiplier.multiply(m);
                }
            }
            
            return result;
        };
        
        //gets called when the parser finds the , operator. 
        this.comma = function(a, b) { 
            if(a instanceof Array) a.push(b);
            else a = [a,b];
            return a;
        };
    };
    
    /* "STATIC" */
    //converts a number to a fraction. 
    var Fraction = {
        /**
         * Converts a decimal to a fraction
         * @param {number} value
         * @returns {Array} - an array containing the denominator and the numerator
         */
        convert: function( value, opts ) {
            var frac;
            if( value === 0 ) {
                frac = [ 0, 1];
            }
            else {
                if( value < 1e-6 || value > 1e20) {
                    var qc = this.quickConversion( Number( value ) );
                    if( qc[1] <= 1e20 ) {
                        var abs = Math.abs( value );
                        var sign = value/abs;
                        frac = this.fullConversion( abs.toFixed( (qc[1]+'').length-1 ));
                        frac[0] = frac[0]*sign;
                    }
                    else {
                        frac = qc;
                    }
                }
                else {
                    frac = this.fullConversion( value );
                }
            }
            return frac;
        },
        /**
         * If the fraction is too small or too large this gets called instead of fullConversion method
         * @param {number} dec
         * @returns {Array} - an array containing the denominator and the numerator
         */
        quickConversion: function( dec ) {
            var x = (dec.toExponential()+'').split('e');
            var d = x[0].split('.')[1];// get the number of places after the decimal
            var l = d ? d.length : 0; // maybe the coefficient is an integer;
            return [Math.pow(10,l)*x[0], Math.pow(10, Math.abs(x[1])+l)];
        },
        /**
         * Returns a good approximation of a fraction. This method gets called by convert
         * http://mathforum.org/library/drmath/view/61772.html
         * Decimal To Fraction Conversion - A Simpler Version
         * Dr Peterson
         * @param {number} dec
         * @returns {Array} - an array containing the denominator and the numerator
         */
        fullConversion: function( dec ) {
            var done = false;
            //you can adjust the epsilon to a larger number if you don't need very high precision
            var n1 = 0, d1 = 1, n2 = 1, d2 = 0, n = 0, q = dec, epsilon = 1e-13;
            while(!done) {
                n++;
                if( n > 10000 ){
                    done = true;
                }
                var a = Math.floor(q);
                var num = n1 + a * n2;
                var den = d1 + a * d2;
                var e = (q - a);
                if( e < epsilon) {
                    done = true;
                }
                q = 1/e;
                n1 = n2; d1 = d2; n2 = num; d2 = den;
                if(Math.abs(num/den-dec) < epsilon || n > 30) {
                    done = true;
                }
            }
            return [num, den];
        }
    };

    //Depends on Fraction
    //The latex generator
    var Latex = {
        space: '~',
        latex: function(obj, abs, group, addParens) { 
            abs = abs || false;
            group = group || obj.group; 
            
            var output = '',
                inBraces = this.inBraces, 
                value;
            if(isSymbol(obj)) { 
                switch(group) {
                    case N:
                        value = obj.multiplier;
                        
                        if(abs) value = Math.abs(value);

                        if(isInt(value)) {
                            output = value;
                        }
                        else if(Math.abs(value) === Infinity) {
                            output = '\\infty';
                            if(value === -Infinity) output = '-'+output;
                        }
                        else {
                            var result = Fraction.convert(value);
                            output = this.fraction(result);
                        }  
                        break;
                    case S:
                        output = this.renderSymbolLatex(obj, undefined, abs);
                        break;
                    case FN: 
                        var name = obj.fname;
                        if(name === PARENTHESIS) name = '';
                        else if(name in Math || name in Math2) name = '\\'+name;

                        var fnInput = obj.args.slice(0).map(function(item) {
                            return Latex.latex(item);
                        });
                        if(name === '\\abs') {
                            value = '\\left|'+fnInput+'\\right|';
                        }
                        else {
                            value = name+this.inBrackets(fnInput);
                        }
                        
                        output = this.renderSymbolLatex(obj, value, abs);
                        
                        break;
                    case PL:
                        var value = this.renderSubSymbolsLatex(obj, function(a,b) {
                            return a.power < b.power;
                        }, undefined, abs);

                        output = this.renderSymbolLatex(obj, value, abs, obj.group === EX);
                        break;
                    case CP:
                        value = this.renderSubSymbolsLatex(obj, function(a,b) {
                            return a.group < b.group;
                        }, undefined, abs);

                        output = this.renderSymbolLatex(obj, value, abs, obj.group === EX);
                        break;
                    case CB: 
                        value = this.renderSubSymbolsLatex(obj, function(a,b) {
                            return a.group < b.group;
                        }, true, abs);
                        
                        output = this.renderSymbolLatex(obj,value, abs);
                        break;
                    case EX:
                        var pg = obj.previousGroup;
                        if(pg === N) {
                            //:) lie about the previous group and render it as a symbol
                            pg = S;
                        }
                        output = this.latex(obj, abs, pg);

                        break;
                }
            }
            else if(isArray(obj)) {
                var l = obj.length;
                for(var i=0; i<l; i++) {
                    output = '\\left['+obj.map(function(a) { return Latex.latex(a); }).join(' ,')+'\\right]';
                }
            }
            else if(typeof obj.latex === 'function') {
                output = obj.latex();
            }
            else {
                output = obj;
            }

            if(addParens) output = this.inBrackets(output);
            
            return output;
        },
        //renders the sub-symbols in complex symbols
        renderSubSymbolsLatex: function(symbol, sortFunction, suppressPlus, abs) { 
            var subSymbols = symbol.collectSymbols().sort(sortFunction),
                l = subSymbols.length, 
                denom = [], i,
                self = this,
                g = symbol.group,
                sqrt = Math.abs(symbol.power) === 0.5;

            for(i=0; i<l; i++) {
                var s = subSymbols[i];
                if(s.isInverse() && g === CB) {
                    denom.push(remove(subSymbols, i).clone().invert());
                    i--, l--; //adjust the index and the length since we're one item shorter
                }
            }
            if(sortFunction) {
                subSymbols.sort(sortFunction);
                denom.sort(sortFunction);
            }
            
            function convert(arr) { 
                var i, l = arr.length, rendered = '';
                for(var i=0; i<l; i++) {
                    var curSymbol = arr[i], delimiter;

                    if(curSymbol.multiplier.lessThan(0)) {
                        delimiter = '-';
                    }
                    else if(suppressPlus){
                        delimiter = '';
                    }
                    else {
                        delimiter = '+';
                    }
                    //leave the negative for the first symbol
                    abs = abs || i > 0;
                    //TODO: redundant brackets in denominator when denominator is CP or PL
                    var latex = self.latex(curSymbol, abs, undefined, 
                        symbol.group === CB && (curSymbol.group === PL || curSymbol.group === CP));
                        
                    //only add the delimiter to the first one
                    if(i > 0) latex = delimiter+latex;
                    //add it to the total rendered

                    rendered += latex;
                }
                
                return rendered;
            }
            var num = convert(subSymbols),
                denom = convert(denom); 
            if(g === CP || g === PL) {
                if(num && !denom && Math.abs(symbol.multiplier) !== 1 || Math.abs(symbol.power !== 1)) {
                    if(!sqrt) num = Latex.inBrackets(num);
                }
            }

            if(denom && !num) num = 1;
            if(denom) return format('\\frac{{0}}{{1}}', num, denom);
            else return num;
        },
        //renders the style for the multiplier and power of the symbol.
        renderSymbolLatex: function(symbol, value, abs, bracketed) { 
            if(symbol.group === N) return this.latex(symbol, abs);
            value = value || symbol.value;
            
            var multiplierArray = Fraction.convert(symbol.multiplier),
                power = symbol.power || '',
                sign = symbol.multiplier < 0 ? '-' : '',//store the sign
                sqrt = (power) === 0.5,
                sqrtDenom = power === -0.5;
            
            //if the latex was requested as absolute value remove the sign
            if(abs) sign = '';
            
            //make the multiplier array positive
            multiplierArray[0] = Math.abs(multiplierArray[0]);
            
            //handle powers
            if(isSymbol(power)) {
                power = this.latex(power, true);
            }
            else {
                if(Math.abs(power) === 1 || sqrt || sqrtDenom) { 
                    power = '';
                }
                else {
                    var powerArray = Fraction.convert(power);
                    if(powerArray[1] === 1) powerArray.pop();
                    
                    if(symbol.power < 0) {
                        powerArray[0] = Math.abs(powerArray[0]);
                    }
                    power = this.fraction(powerArray);
                }
            }

            //remove the one from the base of the fraction
            if(multiplierArray[1] === 1) multiplierArray.pop();
            
            //if there's a power, the location where we attach it depends on the sign of the power.
            //if negative it's bottom, otherwise we attach it to the top.
            var where  = isNegative(symbol.power) ? 1 : 0,
                valueIsFraction = /^\\frac/.test(value); 
            if(multiplierArray[where] === 1) { 
                var dn = multiplierArray[1];
                if(valueIsFraction && dn && dn !== 1) {
                    //TODO: needs a better way of getting denominator
                    var v = betweenBrackets('{', '}', value, betweenBrackets('{', '}', value, 0)[2]+1);
                    value = stringReplace(value, v[1], v[2], multiplierArray.pop()+this.space+v[0])   
                }

                multiplierArray[where] = value;
            }
            else {
                //sub out the multipliers to the top and bottom
                if(valueIsFraction) { 
                    var start = 4;
                    for(var i=0; i<2; i++) {
                        var m0 = multiplierArray[i],
                            m = !(m0 === 1 || m0 === undefined) ? m0+this.space : '';
                        var match = betweenBrackets('{', '}', value, start);
                        multiplierArray[i] = m+match[0];
                        start = match[2]+1;
                    }
                }
                else { 
                    var curValue = multiplierArray[where] ? multiplierArray[where]+this.space : '';
                    if(sqrtDenom) value = '\\sqrt'+this.inBraces(value);
                    if(sqrt) {
                        value = '\\sqrt'+this.inBraces(value);
                        sqrt = false;
                    }
                    multiplierArray[where] = curValue+value;
                }
            }
            
            if(power) { 
                multiplierArray[where] = this[bracketed ? 'inBrackets': 'inBraces'](multiplierArray[where]);
                if(!sqrt) {
                    multiplierArray[where] += '^'+this.inBraces(power);
                }
            }

            //write the value into a fraction
            value = this.fraction(multiplierArray);
            var retval = sign+value;

            if(sqrt) retval = '\\sqrt'+this.inBraces(retval);
            
            return retval;
        },

        fraction: function(fractionArray) {
            if(fractionArray.length === 1) return fractionArray[0];
            return '\\frac'+this.inBraces(fractionArray[0])+this.inBraces(fractionArray[1]);
        },
        inBraces: function(contents, index) {
            index = index === undefined ? '' : '$'+index;
            return '{'+contents+index+'}';
        },
        inBrackets: function(contents) {
            return '\\left('+contents+'\\right)';
        },
        write2Fraction: function(fraction, top, bottom) {
            return fraction.replace('$1', top).replace('$2', bottom);
        }
    };
    
    function Vector(v) { 
        if(isVector(v)) this.elements = v.items.slice(0);
        else if(isArray(v)) this.elements = v.slice(0);
        else this.elements = [].slice.call(arguments);
    }
    
    Vector.arrayPrefill = function(n, val) {
        var a = [];
        val = val || 0;
        for(var i=0; i<n; i++) a[i] = val;
        return a;
    };
    
    //Ported from Sylvester.js
    Vector.prototype = {
        custom: true,
        // Returns element i of the vector
        e: function(i) {
            return (i < 1 || i > this.elements.length) ? null : this.elements[i-1];
        },
        
        set: function(i, val) {
            this.elements[i] = new Symbol(val);
        },
        
        // Returns the number of elements the vector has
        dimensions: function() {
            return this.elements.length;
        },

        // Returns the modulus ('length') of the vector
        modulus: function() {
            return block('SAFE', function() {
                return _.pow((this.dot(this.clone())), new Symbol(0.5));
            }, undefined, this);
        },

        // Returns true iff the vector is equal to the argument
        eql: function(vector) {
            var n = this.elements.length;
            var V = vector.elements || vector;
            if (n !== V.length) { return false; }
            do {
                if (Math.abs(_.subtract(this.elements[n-1],V[n-1]).valueOf()) > PRECISION) { return false; }
            } while (--n);
            return true;
        },

        // Returns a clone of the vector
        clone: function() {
            var V = new Vector(),
                l = this.elements.length;
            for(var i=0; i<l; i++) {
                //Rule: all items within the vector must have a clone method.
                V.elements.push(this.elements[i].clone());
            }
            return V;
        },

        // Maps the vector to another vector according to the given function
        map: function(fn) {
            var elements = [];
            this.each(function(x, i) {
                elements.push(fn(x, i));
            });
            return new Vector(elements);
        },

        // Calls the iterator for each element of the vector in turn
        each: function(fn) {
            var n = this.elements.length, k=n, i;
            do { 
                i = k-n;
                fn(this.elements[i], i+1);
            } while (--n);
        },

        // Returns a new vector created by normalizing the receiver
        toUnitVector: function() {
            return block('SAFE', function() {
                var r = this.modulus();
                if (r.valueOf() === 0) { return this.clone(); }
                return this.map(function(x) { return _.divide(x, r); });
            }, undefined, this);    
        },

        // Returns the angle between the vector and the argument (also a vector)
        angleFrom: function(vector) {
            return block('SAFE', function() {
                var V = vector.elements || vector;
                var n = this.elements.length;
                if (n !== V.length) { return null; }
                var dot = new Symbol(0), mod1 = new Symbol(0), mod2 = new Symbol(0);
                // Work things out in parallel to save time
                this.each(function(x, i) {
                    dot = _.add(dot, _.multiply(x, V[i-1]));
                    mod1 = _.add(mod1, _.multiply(x, x));//will not conflict in safe block
                    mod2 = _.add(mod2, _.multiply(V[i-1], V[i-1]));//will not conflict in safe block
                });
                mod1 = _.pow(mod1, new Symbol(0.5)); mod2 = _.pow(mod2, new Symbol(0.5));
                var product = _.multiply(mod1,mod2);
                if(product.valueOf() === 0) { return null; }
                var theta = _.divide(dot, product);
                var theta_val = theta.valueOf();
                if(theta_val < -1) { theta = -1; }
                if (theta_val > 1) { theta = 1; }
                return new Symbol(Math.acos(theta));
            }, undefined, this);
        },

        // Returns true iff the vector is parallel to the argument
        isParallelTo: function(vector) {
          var angle = this.angleFrom(vector).valueOf();
          return (angle === null) ? null : (angle <= PRECISION);
        },

        // Returns true iff the vector is antiparallel to the argument
        isAntiparallelTo: function(vector) {
          var angle = this.angleFrom(vector).valueOf();
          return (angle === null) ? null : (Math.abs(angle - Math.PI) <= Sylvester.precision);
        },

        // Returns true iff the vector is perpendicular to the argument
        isPerpendicularTo: function(vector) {
          var dot = this.dot(vector);
          return (dot === null) ? null : (Math.abs(dot) <= Sylvester.precision);
        },

        // Returns the result of adding the argument to the vector
        add: function(vector) {
            return block('SAFE', function(){
                var V = vector.elements || vector;
                if (this.elements.length !== V.length) { return null; }
                return this.map(function(x, i) { return _.add(x, V[i-1]); });
            }, undefined, this);
        },

        // Returns the result of subtracting the argument from the vector
        subtract: function(vector) {
            return block('SAFE', function(){
                var V = vector.elements || vector;
                if (this.elements.length !== V.length) { return null; }
                return this.map(function(x, i) { return _.subtract(x, V[i-1]); });
            }, undefined, this);
        },

        // Returns the result of multiplying the elements of the vector by the argument
        multiply: function(k) {
            return this.map(function(x) { return x.clone()*k.clone(); });
        },

        x: function(k) { return this.multiply(k); },

        // Returns the scalar product of the vector with the argument
        // Both vectors must have equal dimensionality
        dot: function(vector) {
            return block('SAFE', function() {
                var V = vector.elements || vector;
                var product = new Symbol(0), n = this.elements.length;
                if (n !== V.length) { return null; }
                do { product = _.add(product, _.multiply(this.elements[n-1], V[n-1])); } while (--n);
                return product;
            }, undefined, this);  
        },

        // Returns the vector product of the vector with the argument
        // Both vectors must have dimensionality 3
        cross: function(vector) {
            var B = vector.elements || vector;
            if(this.elements.length !== 3 || B.length !== 3) { return null; }
            var A = this.elements;
            return block('SAFE', function() {
                return new Vector([
                    _subtract(_.multiply(A[1], B[2]), _.multiply(A[2], B[1])),
                    _subtract(_.multiply(A[2], B[0]), _.multiply(A[0], B[2])),
                    _subtract(_.multiply(A[0], B[1]), _.multiply(A[1], B[0]))
                ]);
            }, undefined, this);  
        },

        // Returns the (absolute) largest element of the vector
        max: function() {
            var m = 0, n = this.elements.length, k = n, i;
            do { i = k - n;
                if(Math.abs(this.elements[i].valueOf()) > Math.abs(m.valueOf())) { m = this.elements[i]; }
            } while (--n);
            return m;
        },

        // Returns the index of the first match found
        indexOf: function(x) {
            var index = null, n = this.elements.length, k = n, i;
            do { 
                i = k-n;
                if(index === null && this.elements[i].valueOf() === x.valueOf()) {
                    index = i+1;
                }
            } while (--n);
            return index;
        },
        text: function(x) {
            return text(this);
        },
        toString: function() {
            return this.text();
        },
        latex: function() {
            var tex = [];
            for(var el in this.elements) {
                tex.push(Latex.latex.call(Latex, this.elements[el]));
            }
            return '['+tex.join(', ')+']';
        }
    };
    
    function Matrix() {
        var m = arguments,
            l = m.length, i, el = [];
        if(isMatrix(m)) { //if it's a matrix then make a clone
            for(i=0; i<l; i++) {
                el.push(m[i].slice(0));
            }
        }
        else {
            var row, lw, rl;
            for(i=0; i<l; i++) {
                row = m[i];
                if(isVector(row)) row = row.elements;
                if(!isArray(row)) row = [row];
                rl = row.length;
                if(lw && lw !== rl) throw new Error('Unable to create Matrix. Row dimensions do not match!');
                el.push(row);
                lw = rl;
            }
        }
        this.elements = el;
    }
    
    Matrix.identity = function(n) {
        var m = new Matrix();
        for(var i=0; i<n; i++) {
            m.elements.push([]);
            for(var j=0; j<n; j++) {
                m.set(i, j, i === j ? new Symbol(1) : new Symbol(0));
            }
        }
        return m;
    };

    Matrix.fromArray = function(arr) {
        function F(args) {
            return Matrix.apply(this, args);
        }
        F.prototype = Matrix.prototype;

        return new F(arr);
    };
    
    Matrix.zeroMatrix = function(rows, cols) {
        var m = new Matrix();
        for(var i=0; i<rows; i++) {
            m.elements.push(Vector.arrayPrefill(cols, new Symbol(0)));
        }
        return m;
    };
    
    Matrix.prototype = {
        //needs be true to let the parser know not to try to cast it to a symbol
        custom: true, 
        set: function(row, column, value) {
            if(!this.elements[row]) this.elements[row] = [];
            this.elements[row][column] = new Symbol(value);
        },
        cols: function() {
            return this.elements[0].length;
        },
        rows: function() {
            return this.elements.length;
        },
        row: function(n) {
            if(!n || n > this.cols()) return [];
            return this.elements[n-1];
        },
        col: function(n) {
            var nr = this.rows(),
                col = []; 
            if(n > this.cols() || !n) return col;
            for(var i=0; i<nr; i++) {
                col.push(this.elements[i][n-1]);
            }
            return col;
        },
        eachElement: function(fn) {
            var nr = this.rows(),
                nc = this.cols(), i, j;
            for(i=0; i<nr; i++) {
                for(j=0; j<nc; j++) {
                    this.elements[i][j] = fn.call(this, this.elements[i][j], i, j);
                }
            }
        },
        each: function(fn) {
            var nr = this.rows(),
                nc = this.cols(), i, j;
            for(i=0; i<nr; i++) {
                for(j=0; j<nc; j++) {
                    fn(this.elements[i][j], i, j);
                }
            }
        },
        //ported from Sylvester.js
        determinant: function() {
            if (!this.isSquare()) { return null; }
            var M = this.toRightTriangular();
            var det = M.elements[0][0], n = M.elements.length-1, k = n, i;
            do { 
                i = k-n+1;
                det = _.multiply(det,M.elements[i][i]);
            } while (--n);
            return det;
        },
        isSquare: function() {
            return this.elements.length === this.elements[0].length;
        },
        isSingular: function() {
            return this.isSquare() && this.determinant() === 0;
        },
        augment: function(m) {
            var r = this.rows(), rr = m.rows();
            if(r !== rr) throw new Error("Cannot augment matrix. Rows don't match.");
            for(var i=0; i<r; i++) {
                this.elements[i] = this.elements[i].concat(m.elements[i]);
            }
            return this;
        },
        clone: function() {
            var r = this.rows(), c = this.cols(),
                m = new Matrix();
            for(var i=0; i<r; i++) {
                m.elements[i] = [];
                for(var j=0; j<c; j++) { 
                    var symbol = this.elements[i][j]; 
                    m.elements[i][j] = isSymbol(symbol) ? symbol.clone() : symbol;
                }
            }
            return m;
        },
        //ported from Sylvester.js
        invert: function() {
            if(!this.isSquare()) err('Matrix is not square!');
            return block('SAFE', function() {
                var ni = this.elements.length, ki = ni, i, j;
                var M = this.augment(Matrix.identity(ni)).toRightTriangular(); 
                var np, kp = M.elements[0].length, p, els, divisor;
                var inverse_elements = [], new_element;
                // Matrix is non-singular so there will be no zeros on the diagonal
                // Cycle through rows from last to first
                do { 
                    i = ni-1;
                    // First, normalise diagonal elements to 1
                    els = []; np = kp;
                    inverse_elements[i] = [];
                    divisor = M.elements[i][i];
                    do { 
                        p = kp - np;
                        new_element = _.divide(M.elements[i][p], divisor.clone());
                        els.push(new_element);
                        // Shuffle of the current row of the right hand side into the results
                        // array as it will not be modified by later runs through this loop
                        if (p >= ki) { inverse_elements[i].push(new_element); }
                    } while (--np);
                    M.elements[i] = els;
                    // Then, subtract this row from those above it to
                    // give the identity matrix on the left hand side
                    for (j=0; j<i; j++) {
                      els = []; np = kp;
                      do { p = kp - np;
                        els.push(_.subtract(M.elements[j][p],_.multiply(M.elements[i][p], M.elements[j][i])));
                      } while (--np);
                      M.elements[j] = els;
                    }
                } while (--ni);
                return Matrix.fromArray(inverse_elements);
            }, undefined, this);
        },
        //ported from Sylvester.js
        toRightTriangular: function() {
            return block('SAFE', function(){
                var M = this.clone(), els, fel, nel, 
                    n = this.elements.length, k = n, i, np, kp = this.elements[0].length, p;
                do { 
                    i = k-n;
                    fel = M.elements[i][i]; 
                    if(fel.valueOf() === 0) {
                        for(var j=i+1; j<k; j++) {
                        nel = M.elements[j][i];
                        if (nel && nel.valueOf() !== 0) {
                            els = []; np = kp;
                            do { 
                                p = kp-np; 
                                els.push(_.add(M.elements[i][p].clone(), M.elements[j][p].clone()));
                            } while (--np);
                            M.elements[i] = els;
                            break;
                        }
                      }
                    }
                    var fel = M.elements[i][i]; 
                    if(fel.valueOf() !== 0) {
                        for (j=i+1; j<k; j++) { 
                            var multiplier = _.divide(M.elements[j][i].clone(),M.elements[i][i].clone()); 
                            els = []; np = kp;
                            do { p = kp - np;
                                // Elements with column numbers up to an including the number
                                // of the row that we're subtracting can safely be set straight to
                                // zero, since that's the point of this routine and it avoids having
                                // to loop over and correct rounding errors later
                                els.push(p <= i ? new Symbol(0) : 
                                        _.subtract(M.elements[j][p].clone(), _.multiply(M.elements[i][p].clone(), multiplier.clone())));
                            } while (--np);
                            M.elements[j] = els;
                        }
                    }
                } while (--n);

                return M;  
            }, undefined, this);     
        },
        transpose: function() {
            var rows = this.elements.length, cols = this.elements[0].length;
            var M = new Matrix(), ni = cols, i, nj, j;
            
            do { 
                i = cols - ni;
                M.elements[i] = [];
                nj = rows;
                do { j = rows - nj;
                    M.elements[i][j] = this.elements[j][i].clone();
                } while (--nj);
            } while (--ni);
            return M;
        },
        // Returns true if the matrix can multiply the argument from the left
        canMultiplyFromLeft: function(matrix) {
          var l = isMatrix(matrix) ? matrix.elements.length : matrix.length;
          // this.columns should equal matrix.rows
          return (this.elements[0].length === l);
        },
        multiply: function(matrix) {    
            return block('SAFE', function(){
                var M = matrix.elements || matrix;
                if (!this.canMultiplyFromLeft(M)) { return null; }
                var ni = this.elements.length, ki = ni, i, nj, kj = M[0].length, j;
                var cols = this.elements[0].length, elements = [], sum, nc, c;
                do { 
                    i = ki-ni;
                    elements[i] = [];
                    nj = kj;
                    do { 
                        j = kj - nj;
                        sum = new Symbol(0);
                        nc = cols;
                        do { 
                            c = cols-nc;
                            sum = _.add(sum, _.multiply(this.elements[i][c], M[c][j])) ;
                        } while (--nc);
                      elements[i][j] = sum;
                    } while (--nj);
                } while (--ni);
                return Matrix.fromArray(elements);
            }, undefined, this);
        },
        toVector: function() {
            if(this.rows () === 1 || this.cols() === 1) {
                var v = new Vector();
                v.elements = this.elements;
                return v;
            }
            return this;
        },
        toString: function(newline) {
            var l = this.rows(),
                s = [];
            newline = newline === undefined ? '\n' : newline;
            for(var i=0; i<l; i++) {
                s.push('['+this.elements[i].map(function(x) {
                    return x !== undefined ? x.toString() : '';
                }).join(',')+']');
            }
            return s.join(','+newline);
        },
        text: function() {
            return 'matrix('+this.toString('')+')';
        },
        latex: function() {
            var cols = this.cols(), elements = this.elements; 
            return format('\\begin{vmatrix}{0}\\end{vmatrix}', function() {
                var tex = []; 
                for(var row in elements) {
                    var row_tex = [];
                    for(var i=0; i<cols; i++) {
                        row_tex.push(Latex.latex.call(Latex, elements[row][i]));
                    }
                    tex.push(row_tex.join(' & '));
                }
                return tex.join(' \\cr ');
            });
        }
    };
    
    /* END CLASSES */

    /* FINALIZE */
    var finalize = function() {
        reserveNames(_.constants);
        reserveNames(_.functions);
    };
    
    var build = Utils.build = function(symbol, arg_array) {
        var args = variables(symbol);
        var supplements = [];
        var ftext = function(symbol, xports) { 
            xports = xports || [];
            var c = [],
                group = symbol.group,
                prefix = '';

            var ftext_complex = function(group) {
                var d = group === CB ? '*' : '+',
                    cc = [];
                for(var x in symbol.symbols) cc.push(ftext(symbol.symbols[x], xports)[0]);
                var retval = cc.join(d);
                return retval ? inBrackets(retval) : retval;
            },

            ftext_function = function(bn) {
                var retval;
                if(bn in Math) retval = 'Math.'+bn;
                else {
                    if(supplements.indexOf(bn) === -1) { //make sure you're not adding the function twice
                        //Math2 functions aren't part of the standard javascript
                        //Math library and must be exported.
                        xports.push('var '+bn+' = '+ Math2[bn].toString()+'; ');
                        supplements.push(bn);
                    }
                    retval = bn;
                }
                retval = retval+inBrackets(symbol.args.map(function(x) {
                    return ftext(x, xports)[0];
                }).join(','));
                return retval;
            };

            //the multiplier
            if(group === N) c.push(symbol.multiplier);
            else if(symbol.multiplier.equals(-1)) prefix = '-';
            else if(symbol.multiplier.equals(1)) c.push(symbol.multiplier.toDecimal());
            //the value
            var value = null;

            if(group === S) value = symbol.value;
            else if(group === FN) { 
                value = ftext_function(symbol.fname);
            }
            else if(group === EX) {
                var pg = symbol.previousGroup;
                if(pg === N || pg === S) value = symbol.value;
                else if(pg === FN) value = ftext_function(symbol.fname);
                else value = ftext_complex(symbol.previousGroup);
            }
            else {
                value = ftext_complex(symbol.group);
            }     

            if(symbol.power !== undefined && symbol.power !== 1) {
                value = 'Math.pow'+inBrackets(value+','+text(symbol.power));
            }

            if(value) c.push(prefix+value);

            return [c.join('*'), xports.join('').replace(/\n+\s+/g, ' ')];
        };
        if(arg_array) {
            if(args.length !== arg_array.length) err('Argument array contains wrong number of arguments');
            for(var i=0; i<args.length; i++) {
                var arg = args[i];
                if(arg_array.indexOf(arg) === -1) err(arg+' not found in argument array');
            }
            args = arg_array;
        }
        var f_array = ftext(symbol);
        return new Function(args, f_array[1]+' return '+f_array[0]+';');
    };
    
    finalize(); //final preparations
    /* END FINALIZE */

    /* BUILD CORE */
    //This contains all the parts of nerdamer and enables nerdamer's internal functions
    //to be used.
    var C = {};
    C.groups = Groups;
    C.Symbol = Symbol;
    C.Expression = Expression;
    C.Vector = Vector;
    C.Matrix = Matrix;
    C.Parser = Parser;
    C.Fraction = Fraction;
    C.Math2 = Math2;
    C.Latex = Latex;
    C.Utils = Utils;
    C.PARSER = _;
    C.PARENTHESIS = PARENTHESIS;
    C.Settings = Settings;
    C.VARS = VARS;
    C.err = err;
    /* END BUILD CORE */

    
    /* EXPORTS */
    /**
     * 
     * @param {String} expression the expression to be evaluated
     * @param {Object} subs the object containing the variable values
     * @param {Integer} location a specific location in the equation list to 
     * insert the evaluated expression
     * @param {String} option additional options
     * @returns {Expression} 
     */
    
    var libExports = function(expression, subs, option, location) {
        var variable;
        var fn;
        var args;
        //handle preprocessors
        expression = preprocess(expression);
        //convert any expression passed in to a string
        if(expression instanceof Expression) expression = expression.toString();
        
        var parts = expression.split('=');
        //have the expression point to the second part instead
        if(parts.length > 1) {
            //Check if parts[0] is a function
            if (/\w+\((.*)\)/.test(parts[0].replace(/\s/g, ''))) {
                fn = /\w+(?=\()/.exec(parts[0])[0];
                args = /\((.*)(?=\))/.exec(parts[0])[1].replace(/\s/g, '').split(',');
            } else {
                variable = parts[0];
            }
            expression = parts[1];
        }
        
        var multi_options = isArray(option),
            expand = 'expand',
            numer = multi_options ? option.indexOf('numer') !== -1 : option === 'numer';
        if((multi_options ? option.indexOf(expand) !== -1 : option === expand) 
                && typeof C.Algebra.expand !== 'undefined') {
            expression = format('{0}({1})', expand, expression);
        }
        var e = block('PARSE2NUMBER', function(){
            return _.parse(expression, format_subs(subs));
        }, numer || Settings.PARSE2NUMBER);
        
        if(location) { EQNS[location-1] = e; }
        else { EQNS.push(e);}
        
        if(variable) libExports.setVar(variable, e);
        if(fn) libExports.setFunction(fn, args, e);
        
        return new Expression(e);
    };
    
    /**
     * 
     * @returns {String} returns the version of nerdamer
     */
    libExports.version = function() {
        return version;
    };
    
    /**
     * 
     * @param {String} constant The name of the constant to be set
     * @param {mixed} value The value of the constant 
     * @returns {Object} Returns the nerdamer object
     */
    libExports.setConstant = function(constant, value) {
        validateName(constant); 
        if(!isReserved(constant)) {
            if(value === 'delete') {
                delete _.constants[constant];
            }
            else {
                if(isNaN(value)) throw new Error('Constant must be a number!');
                _.constants[constant] =  value;
            }
        }    
        return this;
    };
    
    /**
     * 
     * @param {String} name The name of the function
     * @param {Array} params_array A list containing the parameter name of the functions
     * @param {String} body The body of the function
     * @returns {Boolean} returns true if succeeded and falls on fail
     * @example nerdamer.setFunction('f',['x'], 'x^2+2');
     */
    libExports.setFunction = function(name, params_array, body) {
        validateName(name);
        if(!isReserved(name)) {
            params_array = params_array || variables(_.parse(body));
            _.functions[name] = [_.mapped_function, params_array.length, {
                    name: name,
                    params: params_array,
                    body: body
            }];
            return true;
        }
        return false;
    };
    
    /**
     * 
     * @returns {C} Exports the nerdamer core functions and objects
     */
    libExports.getCore = function() {
        return C;
    };

    libExports.getExpression = libExports.getEquation = Expression.getExpression;
    
    /**
     * 
     * @param {Boolean} asArray The returned names are returned as an array if this is set to true;
     * @returns {String|Array}
     */
    libExports.reserved = function(asArray) {
        if(asArray){ return RESERVED; }
        return RESERVED.join(', ');
    };
    
    /**
     * 
     * @param {Integer} equation_number the number of the equation to clear. 
     * If 'all' is supplied then all equations are cleared
     * @param {Boolean} keep_EQNS_fixed use true if you don't want to keep EQNS length fixed
     * @returns {Object} Returns the nerdamer object
     */
    libExports.clear = function( equation_number, keep_EQNS_fixed ) { 
        if(equation_number === 'all') { EQNS = []; }
        else if(equation_number === 'last') { EQNS.pop(); }
        else if(equation_number === 'first') { EQNS.shift(); }
        else { 
            var index = !equation_number ? EQNS.length : equation_number-1; 
            keep_EQNS_fixed === true ? EQNS[index] = undefined : remove(EQNS, index);
        }   
        return this;
    };
    
    /**
     * 
     * @param {Boolean} asObject
     * @param {Boolean} asLatex
     * @returns {Array}
     */
    libExports.expressions = function( asObject, asLatex ) {
        var result = asObject ? {} : [];
        for(var i=0; i<EQNS.length; i++) {
            var eq = asLatex ? Latex.latex(EQNS[i]) : text(EQNS[i]);
            asObject ? result[i+1] = eq : result.push(eq);
        }
        return result;
    };
    
    //the method for registering modules
    libExports.register = function(obj) { 
        var core = this.getCore();
        
        if(isArray(obj)) {
            for(var i=0; i<obj.length; i++) {
                if(obj) this.register(obj[i]);
            }
        }
        else if(obj && Settings.exclude.indexOf(obj.name) === -1) {
            //make sure all the dependencies are available
            if(obj.dependencies) {
                for(var i=0; i<obj.dependencies.length; i++)
                    if(!core[obj.dependencies[i]]) 
                        throw new Error(format('{0} requires {1} to be loaded!', obj.name, obj.dependencies[i]));
            }
            //if no parent object is provided then the function does not have an address and cannot be called directly
            var parent_obj = obj.parent, 
                fn = obj.build.call(core); //call constructor to get function
            if(parent_obj) {
                if(!core[parent_obj]) core[obj.parent] = {};
                
                var ref_obj = parent_obj === 'nerdamer' ? this : core[parent_obj];
                //attach the function to the core
                ref_obj[obj.name] = fn;
            }
            if(obj.visible) _.functions[obj.name] = [fn, obj.numargs]; //make the function available
            
        } 
    };
    
    /**
     * @param {String} name variable name
     * @returns {boolean} validates if the profided string is a valid variable name
     */
    libExports.validateName = validateName;
    
    /**
     * 
     * @returns {Array} Array of functions currently supported by nerdamer
     */
    libExports.supported = function() {
        return keys(_.functions);
    };
    
    /**
     * 
     * @returns {Number} The number equations/expressions currently loaded
     */
    libExports.numEquations = libExports.numExpressions = function() {
        return EQNS.length;
    };
    /* END EXPORTS */
    
    /**
     * 
     * @param {String} v variable to be set
     * @param {String} val value of variable. This can be a variable expression or number
     * @returns {Object} Returns the nerdamer object
     */
    libExports.setVar = function(v, val) {
        validateName(v);
        if(val === 'delete') delete VARS[v];
        else {
            VARS[v] = isSymbol(val) ? val : _.parse(val);
        }
        return this;
    };

    /**
     * Clear the variables from the VARS object
     * @returns {Object} Returns the nerdamer object
     */    
    libExports.clearVars = function() {
        VARS = {};
        return this;
    };
    
    /**
     * @param {String} Output format. Can be 'object' (just returns the VARS object), 'text' or 'latex'. Default: 'text'
     * @returns {Object} Returns an object with the variables
     */    
    libExports.getVars = function(output) {
        output = output || 'text';
        var variables = {};
        if (output === 'object') variables = VARS;
        else {
            for (var v in VARS) {
                if (output === 'latex') {
                    variables[v] = VARS[v].latex();
                } else if (output === 'text') {
                    variables[v] = VARS[v].text();
                }
            }
        }
        return variables;
    };
    
    libExports.addPreprocessor = function(f) {
        return PREPROCESSORS.push(f);
    };
    
    libExports.removePreprocessor = function(n) {
        if(n===PREPROCESSORS.length) PREPROCESSORS.pop();
        PREPROCESSORS.splice(n-1, 1, undefined);
    };
    
    /**
     * 
     * @param {String} setting The setting to be changed
     * @param {boolean} value 
     */
    libExports.set = function(setting, value) {
        //current options:
        //PARSE2NUMBER, suppress_errors
        var disallowed = ['SAFE'];
        if(disallowed.indexOf(setting) !== -1) err('Cannot modify setting: '+setting);
        Settings[setting] = value;
    };

    return libExports; //Done
})();

if((typeof module) !== 'undefined') {
    module.exports = nerdamer;
}
