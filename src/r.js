// Note: 
  // now is not the time for optimization. 
  // That comes later.
"use strict";
  const DEBUG             = true;
  const KEYMATCH          = / ?(key\d+) ?/gm;
  const KEYLEN            = 20;
  const OURPROPS          = 'code,externals,nodes,to,update,v';
  const CODE              = ''+Math.random();
  const XSS               = () => `Possible XSS / object forgery attack detected. ` +
                            `Object value could not be verified.`;
  const OBJ               = () => `Object values not allowed here.`;
  const UNSET             = () => `Unset values not allowed here.`;
  const MOVE              = new class {
                              beforeEnd   (frag,elem) { elem.appendChild(frag) }
                              beforeBegin (frag,elem) { elem.parentNode.insertBefore(frag,elem) }
                              afterEnd    (frag,elem) { elem.parentNode.insertBefore(frag,elem.nextSibling) }
                              replace     (frag,elem) { elem.parentNode.replaceChild(frag,elem) }
                              afterBegin  (frag,elem) { elem.insertBefore(frag,elem.firstChild) }
                              innerHTML   (frag,elem) { elem.innerHTML = ''; elem.appendChild(frag) }
                            };
  const INSERT            = () => `Error inserting template into DOM. ` +
                            `Position must be one of: ` +
                            `replace, beforeBegin, afterBegin, beforeEnd, innerHTML, afterEnd`;
  const isKey             = v => typeof v === "object" &&  typeof v.key == "string";
  const cache = {};

  export {R};

  function R(p,...v) {
    v = v.map(parseVal);

    const {key:instanceKey} = (v.find(isKey) || {});
    const cacheKey = p.join('<link rel=join>');
    const {cached,firstCall} = isCached(cacheKey,v,instanceKey);
   
    if ( ! firstCall ) return cached;

    p = [...p]; 
    const vmap = {};
    const V = v.map(replaceVal(vmap));
    const externals = [];
    let str = '';

    while( p.length > 1 ) str += p.shift() + V.shift();
    str += p.shift();

    const frag = toDOM(str);
    const walker = document.createTreeWalker(frag, NodeFilter.SHOW_ALL);

    do makeUpdaters({walker,vmap,externals}); while(walker.nextNode())

    const retVal = {externals,v:Object.values(vmap),to,
      update,code:CODE,nodes:[...frag.childNodes]};
    if ( !! instanceKey ) {
      cache[cacheKey].instances[instanceKey] = retVal;
    } else {
      cache[cacheKey] = retVal;
    }
    return retVal;
  }

  function makeUpdaters({walker,vmap,externals}) {
    let node = walker.currentNode;
    switch( node.nodeType ) {
      case Node.ELEMENT_NODE:
        handleElementNode({node,vmap,externals});
      break;
      case Node.TEXT_NODE:
        handleTextNode({node,vmap});
      break;
    }
  }

  function handleTextNode({node,vmap}) {
    const lengths = [];
    const text = node.wholeText; 
    let result;
    while( result = KEYMATCH.exec(text) ) {
      const {index} = result;
      const key = result[1];
      const val = vmap[key];
      const replacer = makeTextNodeUpdater({node,index,lengths,valIndex:val.vi});
      replacer(val.val);
      val.replacers.push( replacer );
    }
  }

  function makeTextNodeUpdater({node,index,lengths,valIndex}) {
    let oldNodes = [node];
    let lastAnchor = node;
    return (newVal) => {
      switch(typeof newVal) {
        case "object":
          if ( !! newVal.nodes.length ) {
            newVal.nodes.forEach(n => lastAnchor.parentNode.insertBefore(n,lastAnchor.nextSibling));
            const dn = diffNodes(oldNodes,newVal.nodes);
            if ( dn.size ) {
              const f = document.createDocumentFragment();
              dn.forEach(n => f.appendChild(n));
            }
            lastAnchor = newVal.nodes[0];
            oldNodes = newVal.nodes;
          }
          break;
        default:
          const lengthBefore = lengths.reduce((sum,x) => sum + (x || 0), 0);
          node.nodeValue = newVal;
          lengths[valIndex] = newVal.length;
          break;
      }
    };
  }

  function handleElementNode({node,vmap,externals}) {
    const lengths = [];
    const oldLengths = [];
    const attrs = [...node.attributes]; 
    attrs.forEach(({name,value}) => {
      let result;
      while( result = KEYMATCH.exec(value) ) {
        const {index} = result;
        const key = result[1];
        const val = vmap[key];
        const replacer = makeAttributeUpdater({node,index,name,externals,lengths,oldLengths,valIndex:val.vi});
        replacer(val.val);
        val.replacers.push( replacer );
      }
    });
  }

  function makeAttributeUpdater({node,index,name,externals,lengths,oldLengths,valIndex}) {
    let oldVal = {length: KEYLEN};
    const originalLengthBefore = Math.max(0,Object.keys(lengths).length-1)*KEYLEN;
    return (newVal) => {
      switch(typeof newVal) {
        case "function":
          if ( name !== 'bond' ) {
            if ( !! oldVal ) {
              node.removeEventListener(name, oldVal);
            }
            node.addEventListener(name, newVal); 
          } else {
            if ( !! oldVal ) {
              const index = externals.indexOf(oldVal);
              if ( index >= 0 ) {
                externals.splice(index,1);
              }
            }
            externals.push(() => newVal(node)); 
          }
          oldVal = newVal;
        break;
        default:
          const attr = node.getAttribute(name);
          if ( attr !== newVal ) {
            lengths[valIndex] = newVal.length;

            const correction = -originalLengthBefore;
            const before = attr.slice(0,index+correction);
            const after = attr.slice(index+correction+oldVal.length);

            node.setAttribute(name,before + newVal + after);

            oldVal = newVal;
          }
      }
    };
  }

  function isCached(cacheKey,v,instanceKey) {
    let firstCall;
    let cached = cache[cacheKey];
    if ( cached == undefined ) {
      cached = cache[cacheKey] = {};
      if ( !! instanceKey ) {
        cached.instances = {};
        cached = cached.instances[instanceKey] = {};
      }
      firstCall = true;
    } else {
      if ( !! instanceKey ) {
        if ( ! cached.instances ) {
          cached.instances = {};
          firstCall = true;
        } else {
          cached = cached.instances[instanceKey];
          if ( ! cached ) {
            firstCall = true;
          } else {
            firstCall = false;
          }
        }
      } else {
        cached.update(v);
        firstCall = false;
      }
    }
    return {cached,firstCall};
  }

  function replaceVal(vmap) {
    return (val,vi) => {
      if ( !! val.key ) {
        return '';
      }
      const k = (' key'+Math.random()+' ').replace('.','').padEnd(KEYLEN,'0').slice(0,KEYLEN);
      vmap[k.trim()] = {vi,val,replacers:[]};
      return k;
    };
  }

  function toDOM(str) {
    const f = (new DOMParser).parseFromString(
      `<template>${str}</template>`,"text/html").head.firstElementChild.content;
    f.normalize();
    return f;
  }

  function parseVal(v) {
    const isFunc          = typeof v == "function";
    const isUnset         = v == null         ||    v == undefined;
    const isObject        = !isUnset          &&    typeof v === "object";
    const isGoodArray     = Array.isArray(v)  &&    v.every(itemIsFine);
    const isVerified      = isObject          &&    verify(v);
    const isForgery       = onlyOurProps(v)   &&    !isVerified; 

    if ( isFunc )         return v;
    if ( isVerified )     return v;
    if ( isKey(v) )       return v;
    if ( isGoodArray )    return join(v); 
    if ( isUnset )        die({error: UNSET()});
    if ( isForgery )      die({error: XSS()});
    if ( isObject )       die({error: OBJ()});

    return v+'';
  }

  function itemIsFine(v) {
    return onlyOurProps(v) && verify(v);
  }

  function join(os) {
    const externals = [];
    const bigNodes = [];
    os.forEach(o => (externals.push(...o.externals),bigNodes.push(...o.nodes)));
    const retVal = {v:[],code:CODE,nodes:bigNodes,to,update,externals};
    return retVal;
  }

  function to(selector, position = 'replace') {
    const frag = document.createDocumentFragment();
    this.nodes.forEach(n => frag.appendChild(n));
    const elem = selector instanceof HTMLElement ? selector : document.querySelector(selector);
    try {
      MOVE[position](frag,elem);
    } catch(e) {
      die({error: INSERT()},e);
    }
    this.externals.forEach(f => f());
  }

  function diffNodes(last,next) {
    last = new Set(last);
    next = new Set(next);
    return new Set([...last].filter(n => !next.has(n)));
  }

  function update(newVals) {
    this.v.forEach(({vi,replacers}) => replacers.forEach(f => f(newVals[vi])));
  }

  function onlyOurProps(v) {
    return OURPROPS === Object.keys(v||{}).sort().filter(p => p !== 'instances').join(',');
  }

  function verify(v) {
    return CODE === v.code;
  }

  function die(msg,err) {
    if (DEBUG && err) console.warn(err);
    msg.stack = ((DEBUG && err) || new Error()).stack.split(/\s*\n\s*/g);
    throw JSON.stringify(msg,null,2);
  }
