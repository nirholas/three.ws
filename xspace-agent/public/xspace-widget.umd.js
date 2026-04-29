// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§78]

(function(y,b){typeof exports=="object"&&typeof module<"u"?b(exports):typeof define=="function"&&define.amd?define(["exports"],b):(y=typeof globalThis<"u"?globalThis:y||self,b(y.XSpaceWidget={}))})(this,function(y){Object.defineProperty(y,Symbol.toStringTag,{value:"Module"});var b=Object.defineProperty,Ee=(e,t)=>{let s={};for(var i in e)b(s,i,{get:e[i],enumerable:!0});return t||b(s,Symbol.toStringTag,{value:"Module"}),s},g=Object.create(null);g.open="0",g.close="1",g.ping="2",g.pong="3",g.message="4",g.upgrade="5",g.noop="6";var k=Object.create(null);Object.keys(g).forEach(e=>{k[g[e]]=e});var H={type:"error",data:"parser error"},Z=typeof Blob=="function"||typeof Blob<"u"&&Object.prototype.toString.call(Blob)==="[object BlobConstructor]",ee=typeof ArrayBuffer=="function",te=e=>typeof ArrayBuffer.isView=="function"?ArrayBuffer.isView(e):e&&e.buffer instanceof ArrayBuffer,q=({type:e,data:t},s,i)=>Z&&t instanceof Blob?s?i(t):se(t,i):ee&&(t instanceof ArrayBuffer||te(t))?s?i(t):se(new Blob([t]),i):i(g[e]+(t||"")),se=(e,t)=>{const s=new FileReader;return s.onload=function(){const i=s.result.split(",")[1];t("b"+(i||""))},s.readAsDataURL(e)};function ie(e){return e instanceof Uint8Array?e:e instanceof ArrayBuffer?new Uint8Array(e):new Uint8Array(e.buffer,e.byteOffset,e.byteLength)}var D;function ke(e,t){if(Z&&e.data instanceof Blob)return e.data.arrayBuffer().then(ie).then(t);if(ee&&(e.data instanceof ArrayBuffer||te(e.data)))return t(ie(e.data));q(e,!1,s=>{D||(D=new TextEncoder),t(D.encode(s))})}var Ce="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",v=typeof Uint8Array>"u"?[]:new Uint8Array(256);for(let e=0;e<64;e++)v[Ce.charCodeAt(e)]=e;var Se=e=>{let t=e.length*.75,s=e.length,i,n=0,r,o,a,h;e[e.length-1]==="="&&(t--,e[e.length-2]==="="&&t--);const u=new ArrayBuffer(t),d=new Uint8Array(u);for(i=0;i<s;i+=4)r=v[e.charCodeAt(i)],o=v[e.charCodeAt(i+1)],a=v[e.charCodeAt(i+2)],h=v[e.charCodeAt(i+3)],d[n++]=r<<2|o>>4,d[n++]=(o&15)<<4|a>>2,d[n++]=(a&3)<<6|h&63;return u},Te=typeof ArrayBuffer=="function",P=(e,t)=>{if(typeof e!="string")return{type:"message",data:ne(e,t)};const s=e.charAt(0);return s==="b"?{type:"message",data:Ae(e.substring(1),t)}:k[s]?e.length>1?{type:k[s],data:e.substring(1)}:{type:k[s]}:H},Ae=(e,t)=>Te?ne(Se(e),t):{base64:!0,data:e},ne=(e,t)=>t==="blob"?e instanceof Blob?e:new Blob([e]):e instanceof ArrayBuffer?e:e.buffer,re="",Be=(e,t)=>{const s=e.length,i=new Array(s);let n=0;e.forEach((r,o)=>{q(r,!1,a=>{i[o]=a,++n===s&&t(i.join(re))})})},Re=(e,t)=>{const s=e.split(re),i=[];for(let n=0;n<s.length;n++){const r=P(s[n],t);if(i.push(r),r.type==="error")break}return i};function Oe(){return new TransformStream({transform(e,t){ke(e,s=>{const i=s.length;let n;if(i<126)n=new Uint8Array(1),new DataView(n.buffer).setUint8(0,i);else if(i<65536){n=new Uint8Array(3);const r=new DataView(n.buffer);r.setUint8(0,126),r.setUint16(1,i)}else{n=new Uint8Array(9);const r=new DataView(n.buffer);r.setUint8(0,127),r.setBigUint64(1,BigInt(i))}e.data&&typeof e.data!="string"&&(n[0]|=128),t.enqueue(n),t.enqueue(s)})}})}var U;function C(e){return e.reduce((t,s)=>t+s.length,0)}function S(e,t){if(e[0].length===t)return e.shift();const s=new Uint8Array(t);let i=0;for(let n=0;n<t;n++)s[n]=e[0][i++],i===e[0].length&&(e.shift(),i=0);return e.length&&i<e[0].length&&(e[0]=e[0].slice(i)),s}function Ne(e,t){U||(U=new TextDecoder);const s=[];let i=0,n=-1,r=!1;return new TransformStream({transform(o,a){for(s.push(o);;){if(i===0){if(C(s)<1)break;const h=S(s,1);r=(h[0]&128)===128,n=h[0]&127,n<126?i=3:n===126?i=1:i=2}else if(i===1){if(C(s)<2)break;const h=S(s,2);n=new DataView(h.buffer,h.byteOffset,h.length).getUint16(0),i=3}else if(i===2){if(C(s)<8)break;const h=S(s,8),u=new DataView(h.buffer,h.byteOffset,h.length),d=u.getUint32(0);if(d>Math.pow(2,21)-1){a.enqueue(H);break}n=d*Math.pow(2,32)+u.getUint32(4),i=3}else{if(C(s)<n)break;const h=S(s,n);a.enqueue(P(r?h:U.decode(h),t)),i=0}if(n===0||n>e){a.enqueue(H);break}}}})}function l(e){if(e)return Le(e)}function Le(e){for(var t in l.prototype)e[t]=l.prototype[t];return e}l.prototype.on=l.prototype.addEventListener=function(e,t){return this._callbacks=this._callbacks||{},(this._callbacks["$"+e]=this._callbacks["$"+e]||[]).push(t),this},l.prototype.once=function(e,t){function s(){this.off(e,s),t.apply(this,arguments)}return s.fn=t,this.on(e,s),this},l.prototype.off=l.prototype.removeListener=l.prototype.removeAllListeners=l.prototype.removeEventListener=function(e,t){if(this._callbacks=this._callbacks||{},arguments.length==0)return this._callbacks={},this;var s=this._callbacks["$"+e];if(!s)return this;if(arguments.length==1)return delete this._callbacks["$"+e],this;for(var i,n=0;n<s.length;n++)if(i=s[n],i===t||i.fn===t){s.splice(n,1);break}return s.length===0&&delete this._callbacks["$"+e],this},l.prototype.emit=function(e){this._callbacks=this._callbacks||{};for(var t=new Array(arguments.length-1),s=this._callbacks["$"+e],i=1;i<arguments.length;i++)t[i-1]=arguments[i];if(s){s=s.slice(0);for(var i=0,n=s.length;i<n;++i)s[i].apply(this,t)}return this},l.prototype.emitReserved=l.prototype.emit,l.prototype.listeners=function(e){return this._callbacks=this._callbacks||{},this._callbacks["$"+e]||[]},l.prototype.hasListeners=function(e){return!!this.listeners(e).length};var T=typeof Promise=="function"&&typeof Promise.resolve=="function"?e=>Promise.resolve().then(e):(e,t)=>t(e,0),f=typeof self<"u"?self:typeof window<"u"?window:Function("return this")(),Me="arraybuffer";function Ct(){}function oe(e,...t){return t.reduce((s,i)=>(e.hasOwnProperty(i)&&(s[i]=e[i]),s),{})}var Ie=f.setTimeout,He=f.clearTimeout;function A(e,t){t.useNativeTimers?(e.setTimeoutFn=Ie.bind(f),e.clearTimeoutFn=He.bind(f)):(e.setTimeoutFn=f.setTimeout.bind(f),e.clearTimeoutFn=f.clearTimeout.bind(f))}var qe=1.33;function De(e){return typeof e=="string"?Pe(e):Math.ceil((e.byteLength||e.size)*qe)}function Pe(e){let t=0,s=0;for(let i=0,n=e.length;i<n;i++)t=e.charCodeAt(i),t<128?s+=1:t<2048?s+=2:t<55296||t>=57344?s+=3:(i++,s+=4);return s}function ae(){return Date.now().toString(36).substring(3)+Math.random().toString(36).substring(2,5)}function Ue(e){let t="";for(let s in e)e.hasOwnProperty(s)&&(t.length&&(t+="&"),t+=encodeURIComponent(s)+"="+encodeURIComponent(e[s]));return t}function Ve(e){let t={},s=e.split("&");for(let i=0,n=s.length;i<n;i++){let r=s[i].split("=");t[decodeURIComponent(r[0])]=decodeURIComponent(r[1])}return t}var Fe=class extends Error{constructor(e,t,s){super(e),this.description=t,this.context=s,this.type="TransportError"}},V=class extends l{constructor(e){super(),this.writable=!1,A(this,e),this.opts=e,this.query=e.query,this.socket=e.socket,this.supportsBinary=!e.forceBase64}onError(e,t,s){return super.emitReserved("error",new Fe(e,t,s)),this}open(){return this.readyState="opening",this.doOpen(),this}close(){return(this.readyState==="opening"||this.readyState==="open")&&(this.doClose(),this.onClose()),this}send(e){this.readyState==="open"&&this.write(e)}onOpen(){this.readyState="open",this.writable=!0,super.emitReserved("open")}onData(e){const t=P(e,this.socket.binaryType);this.onPacket(t)}onPacket(e){super.emitReserved("packet",e)}onClose(e){this.readyState="closed",super.emitReserved("close",e)}pause(e){}createUri(e,t={}){return e+"://"+this._hostname()+this._port()+this.opts.path+this._query(t)}_hostname(){const e=this.opts.hostname;return e.indexOf(":")===-1?e:"["+e+"]"}_port(){return this.opts.port&&(this.opts.secure&&Number(this.opts.port)!==443||!this.opts.secure&&Number(this.opts.port)!==80)?":"+this.opts.port:""}_query(e){const t=Ue(e);return t.length?"?"+t:""}},$e=class extends V{constructor(){super(...arguments),this._polling=!1}get name(){return"polling"}doOpen(){this._poll()}pause(e){this.readyState="pausing";const t=()=>{this.readyState="paused",e()};if(this._polling||!this.writable){let s=0;this._polling&&(s++,this.once("pollComplete",function(){--s||t()})),this.writable||(s++,this.once("drain",function(){--s||t()}))}else t()}_poll(){this._polling=!0,this.doPoll(),this.emitReserved("poll")}onData(e){const t=s=>{if(this.readyState==="opening"&&s.type==="open"&&this.onOpen(),s.type==="close")return this.onClose({description:"transport closed by the server"}),!1;this.onPacket(s)};Re(e,this.socket.binaryType).forEach(t),this.readyState!=="closed"&&(this._polling=!1,this.emitReserved("pollComplete"),this.readyState==="open"&&this._poll())}doClose(){const e=()=>{this.write([{type:"close"}])};this.readyState==="open"?e():this.once("open",e)}write(e){this.writable=!1,Be(e,t=>{this.doWrite(t,()=>{this.writable=!0,this.emitReserved("drain")})})}uri(){const e=this.opts.secure?"https":"http",t=this.query||{};return this.opts.timestampRequests!==!1&&(t[this.opts.timestampParam]=ae()),!this.supportsBinary&&!t.sid&&(t.b64=1),this.createUri(e,t)}},ce=!1;try{ce=typeof XMLHttpRequest<"u"&&"withCredentials"in new XMLHttpRequest}catch{}var ze=ce;function We(){}var Ke=class extends $e{constructor(e){if(super(e),typeof location<"u"){const t=location.protocol==="https:";let s=location.port;s||(s=t?"443":"80"),this.xd=typeof location<"u"&&e.hostname!==location.hostname||s!==e.port}}doWrite(e,t){const s=this.request({method:"POST",data:e});s.on("success",t),s.on("error",(i,n)=>{this.onError("xhr post error",i,n)})}doPoll(){const e=this.request();e.on("data",this.onData.bind(this)),e.on("error",(t,s)=>{this.onError("xhr poll error",t,s)}),this.pollXhr=e}},w=class M extends l{constructor(t,s,i){super(),this.createRequest=t,A(this,i),this._opts=i,this._method=i.method||"GET",this._uri=s,this._data=i.data!==void 0?i.data:null,this._create()}_create(){var t;const s=oe(this._opts,"agent","pfx","key","passphrase","cert","ca","ciphers","rejectUnauthorized","autoUnref");s.xdomain=!!this._opts.xd;const i=this._xhr=this.createRequest(s);try{i.open(this._method,this._uri,!0);try{if(this._opts.extraHeaders){i.setDisableHeaderCheck&&i.setDisableHeaderCheck(!0);for(let n in this._opts.extraHeaders)this._opts.extraHeaders.hasOwnProperty(n)&&i.setRequestHeader(n,this._opts.extraHeaders[n])}}catch{}if(this._method==="POST")try{i.setRequestHeader("Content-type","text/plain;charset=UTF-8")}catch{}try{i.setRequestHeader("Accept","*/*")}catch{}(t=this._opts.cookieJar)===null||t===void 0||t.addCookies(i),"withCredentials"in i&&(i.withCredentials=this._opts.withCredentials),this._opts.requestTimeout&&(i.timeout=this._opts.requestTimeout),i.onreadystatechange=()=>{var n;i.readyState===3&&((n=this._opts.cookieJar)===null||n===void 0||n.parseCookies(i.getResponseHeader("set-cookie"))),i.readyState===4&&(i.status===200||i.status===1223?this._onLoad():this.setTimeoutFn(()=>{this._onError(typeof i.status=="number"?i.status:0)},0))},i.send(this._data)}catch(n){this.setTimeoutFn(()=>{this._onError(n)},0);return}typeof document<"u"&&(this._index=M.requestsCount++,M.requests[this._index]=this)}_onError(t){this.emitReserved("error",t,this._xhr),this._cleanup(!0)}_cleanup(t){if(!(typeof this._xhr>"u"||this._xhr===null)){if(this._xhr.onreadystatechange=We,t)try{this._xhr.abort()}catch{}typeof document<"u"&&delete M.requests[this._index],this._xhr=null}}_onLoad(){const t=this._xhr.responseText;t!==null&&(this.emitReserved("data",t),this.emitReserved("success"),this._cleanup())}abort(){this._cleanup()}};if(w.requestsCount=0,w.requests={},typeof document<"u"){if(typeof attachEvent=="function")attachEvent("onunload",he);else if(typeof addEventListener=="function"){const e="onpagehide"in f?"pagehide":"unload";addEventListener(e,he,!1)}}function he(){for(let e in w.requests)w.requests.hasOwnProperty(e)&&w.requests[e].abort()}var Xe=(function(){const e=le({xdomain:!1});return e&&e.responseType!==null})(),Ye=class extends Ke{constructor(e){super(e);const t=e&&e.forceBase64;this.supportsBinary=Xe&&!t}request(e={}){return Object.assign(e,{xd:this.xd},this.opts),new w(le,this.uri(),e)}};function le(e){const t=e.xdomain;try{if(typeof XMLHttpRequest<"u"&&(!t||ze))return new XMLHttpRequest}catch{}if(!t)try{return new f[["Active"].concat("Object").join("X")]("Microsoft.XMLHTTP")}catch{}}var ue=typeof navigator<"u"&&typeof navigator.product=="string"&&navigator.product.toLowerCase()==="reactnative",Qe=class extends V{get name(){return"websocket"}doOpen(){const e=this.uri(),t=this.opts.protocols,s=ue?{}:oe(this.opts,"agent","perMessageDeflate","pfx","key","passphrase","cert","ca","ciphers","rejectUnauthorized","localAddress","protocolVersion","origin","maxPayload","family","checkServerIdentity");this.opts.extraHeaders&&(s.headers=this.opts.extraHeaders);try{this.ws=this.createSocket(e,t,s)}catch(i){return this.emitReserved("error",i)}this.ws.binaryType=this.socket.binaryType,this.addEventListeners()}addEventListeners(){this.ws.onopen=()=>{this.opts.autoUnref&&this.ws._socket.unref(),this.onOpen()},this.ws.onclose=e=>this.onClose({description:"websocket connection closed",context:e}),this.ws.onmessage=e=>this.onData(e.data),this.ws.onerror=e=>this.onError("websocket error",e)}write(e){this.writable=!1;for(let t=0;t<e.length;t++){const s=e[t],i=t===e.length-1;q(s,this.supportsBinary,n=>{try{this.doWrite(s,n)}catch{}i&&T(()=>{this.writable=!0,this.emitReserved("drain")},this.setTimeoutFn)})}}doClose(){typeof this.ws<"u"&&(this.ws.onerror=()=>{},this.ws.close(),this.ws=null)}uri(){const e=this.opts.secure?"wss":"ws",t=this.query||{};return this.opts.timestampRequests&&(t[this.opts.timestampParam]=ae()),this.supportsBinary||(t.b64=1),this.createUri(e,t)}},F=f.WebSocket||f.MozWebSocket,Je=class extends Qe{createSocket(e,t,s){return ue?new F(e,t,s):t?new F(e,t):new F(e)}doWrite(e,t){this.ws.send(t)}},je=class extends V{get name(){return"webtransport"}doOpen(){try{this._transport=new WebTransport(this.createUri("https"),this.opts.transportOptions[this.name])}catch(e){return this.emitReserved("error",e)}this._transport.closed.then(()=>{this.onClose()}).catch(e=>{this.onError("webtransport error",e)}),this._transport.ready.then(()=>{this._transport.createBidirectionalStream().then(e=>{const t=Ne(Number.MAX_SAFE_INTEGER,this.socket.binaryType),s=e.readable.pipeThrough(t).getReader(),i=Oe();i.readable.pipeTo(e.writable),this._writer=i.writable.getWriter();const n=()=>{s.read().then(({done:o,value:a})=>{o||(this.onPacket(a),n())}).catch(o=>{})};n();const r={type:"open"};this.query.sid&&(r.data=`{"sid":"${this.query.sid}"}`),this._writer.write(r).then(()=>this.onOpen())})})}write(e){this.writable=!1;for(let t=0;t<e.length;t++){const s=e[t],i=t===e.length-1;this._writer.write(s).then(()=>{i&&T(()=>{this.writable=!0,this.emitReserved("drain")},this.setTimeoutFn)})}}doClose(){var e;(e=this._transport)===null||e===void 0||e.close()}},Ge={websocket:Je,webtransport:je,polling:Ye},Ze=/^(?:(?![^:@\/?#]+:[^:@\/]*@)(http|https|ws|wss):\/\/)?((?:(([^:@\/?#]*)(?::([^:@\/?#]*))?)?@)?((?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/,et=["source","protocol","authority","userInfo","user","password","host","port","relative","path","directory","file","query","anchor"];function $(e){if(e.length>8e3)throw"URI too long";const t=e,s=e.indexOf("["),i=e.indexOf("]");s!=-1&&i!=-1&&(e=e.substring(0,s)+e.substring(s,i).replace(/:/g,";")+e.substring(i,e.length));let n=Ze.exec(e||""),r={},o=14;for(;o--;)r[et[o]]=n[o]||"";return s!=-1&&i!=-1&&(r.source=t,r.host=r.host.substring(1,r.host.length-1).replace(/;/g,":"),r.authority=r.authority.replace("[","").replace("]","").replace(/;/g,":"),r.ipv6uri=!0),r.pathNames=tt(r,r.path),r.queryKey=st(r,r.query),r}function tt(e,t){const s=t.replace(/\/{2,9}/g,"/").split("/");return(t.slice(0,1)=="/"||t.length===0)&&s.splice(0,1),t.slice(-1)=="/"&&s.splice(s.length-1,1),s}function st(e,t){const s={};return t.replace(/(?:^|&)([^&=]*)=?([^&]*)/g,function(i,n,r){n&&(s[n]=r)}),s}var z=typeof addEventListener=="function"&&typeof removeEventListener=="function",B=[];z&&addEventListener("offline",()=>{B.forEach(e=>e())},!1);var R=class I extends l{constructor(t,s){if(super(),this.binaryType=Me,this.writeBuffer=[],this._prevBufferLen=0,this._pingInterval=-1,this._pingTimeout=-1,this._maxPayload=-1,this._pingTimeoutTime=1/0,t&&typeof t=="object"&&(s=t,t=null),t){const i=$(t);s.hostname=i.host,s.secure=i.protocol==="https"||i.protocol==="wss",s.port=i.port,i.query&&(s.query=i.query)}else s.host&&(s.hostname=$(s.host).host);A(this,s),this.secure=s.secure!=null?s.secure:typeof location<"u"&&location.protocol==="https:",s.hostname&&!s.port&&(s.port=this.secure?"443":"80"),this.hostname=s.hostname||(typeof location<"u"?location.hostname:"localhost"),this.port=s.port||(typeof location<"u"&&location.port?location.port:this.secure?"443":"80"),this.transports=[],this._transportsByName={},s.transports.forEach(i=>{const n=i.prototype.name;this.transports.push(n),this._transportsByName[n]=i}),this.opts=Object.assign({path:"/engine.io",agent:!1,withCredentials:!1,upgrade:!0,timestampParam:"t",rememberUpgrade:!1,addTrailingSlash:!0,rejectUnauthorized:!0,perMessageDeflate:{threshold:1024},transportOptions:{},closeOnBeforeunload:!1},s),this.opts.path=this.opts.path.replace(/\/$/,"")+(this.opts.addTrailingSlash?"/":""),typeof this.opts.query=="string"&&(this.opts.query=Ve(this.opts.query)),z&&(this.opts.closeOnBeforeunload&&(this._beforeunloadEventListener=()=>{this.transport&&(this.transport.removeAllListeners(),this.transport.close())},addEventListener("beforeunload",this._beforeunloadEventListener,!1)),this.hostname!=="localhost"&&(this._offlineEventListener=()=>{this._onClose("transport close",{description:"network connection lost"})},B.push(this._offlineEventListener))),this.opts.withCredentials&&(this._cookieJar=void 0),this._open()}createTransport(t){const s=Object.assign({},this.opts.query);s.EIO=4,s.transport=t,this.id&&(s.sid=this.id);const i=Object.assign({},this.opts,{query:s,socket:this,hostname:this.hostname,secure:this.secure,port:this.port},this.opts.transportOptions[t]);return new this._transportsByName[t](i)}_open(){if(this.transports.length===0){this.setTimeoutFn(()=>{this.emitReserved("error","No transports available")},0);return}const t=this.opts.rememberUpgrade&&I.priorWebsocketSuccess&&this.transports.indexOf("websocket")!==-1?"websocket":this.transports[0];this.readyState="opening";const s=this.createTransport(t);s.open(),this.setTransport(s)}setTransport(t){this.transport&&this.transport.removeAllListeners(),this.transport=t,t.on("drain",this._onDrain.bind(this)).on("packet",this._onPacket.bind(this)).on("error",this._onError.bind(this)).on("close",s=>this._onClose("transport close",s))}onOpen(){this.readyState="open",I.priorWebsocketSuccess=this.transport.name==="websocket",this.emitReserved("open"),this.flush()}_onPacket(t){if(this.readyState==="opening"||this.readyState==="open"||this.readyState==="closing")switch(this.emitReserved("packet",t),this.emitReserved("heartbeat"),t.type){case"open":this.onHandshake(JSON.parse(t.data));break;case"ping":this._sendPacket("pong"),this.emitReserved("ping"),this.emitReserved("pong"),this._resetPingTimeout();break;case"error":const s=new Error("server error");s.code=t.data,this._onError(s);break;case"message":this.emitReserved("data",t.data),this.emitReserved("message",t.data);break}}onHandshake(t){this.emitReserved("handshake",t),this.id=t.sid,this.transport.query.sid=t.sid,this._pingInterval=t.pingInterval,this._pingTimeout=t.pingTimeout,this._maxPayload=t.maxPayload,this.onOpen(),this.readyState!=="closed"&&this._resetPingTimeout()}_resetPingTimeout(){this.clearTimeoutFn(this._pingTimeoutTimer);const t=this._pingInterval+this._pingTimeout;this._pingTimeoutTime=Date.now()+t,this._pingTimeoutTimer=this.setTimeoutFn(()=>{this._onClose("ping timeout")},t),this.opts.autoUnref&&this._pingTimeoutTimer.unref()}_onDrain(){this.writeBuffer.splice(0,this._prevBufferLen),this._prevBufferLen=0,this.writeBuffer.length===0?this.emitReserved("drain"):this.flush()}flush(){if(this.readyState!=="closed"&&this.transport.writable&&!this.upgrading&&this.writeBuffer.length){const t=this._getWritablePackets();this.transport.send(t),this._prevBufferLen=t.length,this.emitReserved("flush")}}_getWritablePackets(){if(!(this._maxPayload&&this.transport.name==="polling"&&this.writeBuffer.length>1))return this.writeBuffer;let t=1;for(let s=0;s<this.writeBuffer.length;s++){const i=this.writeBuffer[s].data;if(i&&(t+=De(i)),s>0&&t>this._maxPayload)return this.writeBuffer.slice(0,s);t+=2}return this.writeBuffer}_hasPingExpired(){if(!this._pingTimeoutTime)return!0;const t=Date.now()>this._pingTimeoutTime;return t&&(this._pingTimeoutTime=0,T(()=>{this._onClose("ping timeout")},this.setTimeoutFn)),t}write(t,s,i){return this._sendPacket("message",t,s,i),this}send(t,s,i){return this._sendPacket("message",t,s,i),this}_sendPacket(t,s,i,n){if(typeof s=="function"&&(n=s,s=void 0),typeof i=="function"&&(n=i,i=null),this.readyState==="closing"||this.readyState==="closed")return;i=i||{},i.compress=i.compress!==!1;const r={type:t,data:s,options:i};this.emitReserved("packetCreate",r),this.writeBuffer.push(r),n&&this.once("flush",n),this.flush()}close(){const t=()=>{this._onClose("forced close"),this.transport.close()},s=()=>{this.off("upgrade",s),this.off("upgradeError",s),t()},i=()=>{this.once("upgrade",s),this.once("upgradeError",s)};return(this.readyState==="opening"||this.readyState==="open")&&(this.readyState="closing",this.writeBuffer.length?this.once("drain",()=>{this.upgrading?i():t()}):this.upgrading?i():t()),this}_onError(t){if(I.priorWebsocketSuccess=!1,this.opts.tryAllTransports&&this.transports.length>1&&this.readyState==="opening")return this.transports.shift(),this._open();this.emitReserved("error",t),this._onClose("transport error",t)}_onClose(t,s){if(this.readyState==="opening"||this.readyState==="open"||this.readyState==="closing"){if(this.clearTimeoutFn(this._pingTimeoutTimer),this.transport.removeAllListeners("close"),this.transport.close(),this.transport.removeAllListeners(),z&&(this._beforeunloadEventListener&&removeEventListener("beforeunload",this._beforeunloadEventListener,!1),this._offlineEventListener)){const i=B.indexOf(this._offlineEventListener);i!==-1&&B.splice(i,1)}this.readyState="closed",this.id=null,this.emitReserved("close",t,s),this.writeBuffer=[],this._prevBufferLen=0}}};R.protocol=4;var it=class extends R{constructor(){super(...arguments),this._upgrades=[]}onOpen(){if(super.onOpen(),this.readyState==="open"&&this.opts.upgrade)for(let e=0;e<this._upgrades.length;e++)this._probe(this._upgrades[e])}_probe(e){let t=this.createTransport(e),s=!1;R.priorWebsocketSuccess=!1;const i=()=>{s||(t.send([{type:"ping",data:"probe"}]),t.once("packet",d=>{if(!s)if(d.type==="pong"&&d.data==="probe"){if(this.upgrading=!0,this.emitReserved("upgrading",t),!t)return;R.priorWebsocketSuccess=t.name==="websocket",this.transport.pause(()=>{s||this.readyState!=="closed"&&(u(),this.setTransport(t),t.send([{type:"upgrade"}]),this.emitReserved("upgrade",t),t=null,this.upgrading=!1,this.flush())})}else{const E=new Error("probe error");E.transport=t.name,this.emitReserved("upgradeError",E)}}))};function n(){s||(s=!0,u(),t.close(),t=null)}const r=d=>{const E=new Error("probe error: "+d);E.transport=t.name,n(),this.emitReserved("upgradeError",E)};function o(){r("transport closed")}function a(){r("socket closed")}function h(d){t&&d.name!==t.name&&n()}const u=()=>{t.removeListener("open",i),t.removeListener("error",r),t.removeListener("close",o),this.off("close",a),this.off("upgrading",h)};t.once("open",i),t.once("error",r),t.once("close",o),this.once("close",a),this.once("upgrading",h),this._upgrades.indexOf("webtransport")!==-1&&e!=="webtransport"?this.setTimeoutFn(()=>{s||t.open()},200):t.open()}onHandshake(e){this._upgrades=this._filterUpgrades(e.upgrades),super.onHandshake(e)}_filterUpgrades(e){const t=[];for(let s=0;s<e.length;s++)~this.transports.indexOf(e[s])&&t.push(e[s]);return t}},de=class extends it{constructor(e,t={}){const s=typeof e=="object"?e:t;(!s.transports||s.transports&&typeof s.transports[0]=="string")&&(s.transports=(s.transports||["polling","websocket","webtransport"]).map(i=>Ge[i]).filter(i=>!!i)),super(e,s)}},St=de.protocol;function nt(e,t="",s){let i=e;s=s||typeof location<"u"&&location,e==null&&(e=s.protocol+"//"+s.host),typeof e=="string"&&(e.charAt(0)==="/"&&(e.charAt(1)==="/"?e=s.protocol+e:e=s.host+e),/^(https?|wss?):\/\//.test(e)||(typeof s<"u"?e=s.protocol+"//"+e:e="https://"+e),i=$(e)),i.port||(/^(http|ws)$/.test(i.protocol)?i.port="80":/^(http|ws)s$/.test(i.protocol)&&(i.port="443")),i.path=i.path||"/";const n=i.host.indexOf(":")!==-1?"["+i.host+"]":i.host;return i.id=i.protocol+"://"+n+":"+i.port+t,i.href=i.protocol+"://"+n+(s&&s.port===i.port?"":":"+i.port),i}var rt=typeof ArrayBuffer=="function",ot=e=>typeof ArrayBuffer.isView=="function"?ArrayBuffer.isView(e):e.buffer instanceof ArrayBuffer,fe=Object.prototype.toString,at=typeof Blob=="function"||typeof Blob<"u"&&fe.call(Blob)==="[object BlobConstructor]",ct=typeof File=="function"||typeof File<"u"&&fe.call(File)==="[object FileConstructor]";function W(e){return rt&&(e instanceof ArrayBuffer||ot(e))||at&&e instanceof Blob||ct&&e instanceof File}function O(e,t){if(!e||typeof e!="object")return!1;if(Array.isArray(e)){for(let s=0,i=e.length;s<i;s++)if(O(e[s]))return!0;return!1}if(W(e))return!0;if(e.toJSON&&typeof e.toJSON=="function"&&arguments.length===1)return O(e.toJSON(),!0);for(const s in e)if(Object.prototype.hasOwnProperty.call(e,s)&&O(e[s]))return!0;return!1}function ht(e){const t=[],s=e.data,i=e;return i.data=K(s,t),i.attachments=t.length,{packet:i,buffers:t}}function K(e,t){if(!e)return e;if(W(e)){const s={_placeholder:!0,num:t.length};return t.push(e),s}else if(Array.isArray(e)){const s=new Array(e.length);for(let i=0;i<e.length;i++)s[i]=K(e[i],t);return s}else if(typeof e=="object"&&!(e instanceof Date)){const s={};for(const i in e)Object.prototype.hasOwnProperty.call(e,i)&&(s[i]=K(e[i],t));return s}return e}function lt(e,t){return e.data=X(e.data,t),delete e.attachments,e}function X(e,t){if(!e)return e;if(e&&e._placeholder===!0){if(typeof e.num=="number"&&e.num>=0&&e.num<t.length)return t[e.num];throw new Error("illegal attachments")}else if(Array.isArray(e))for(let s=0;s<e.length;s++)e[s]=X(e[s],t);else if(typeof e=="object")for(const s in e)Object.prototype.hasOwnProperty.call(e,s)&&(e[s]=X(e[s],t));return e}var ut=Ee({Decoder:()=>ft,Encoder:()=>dt,PacketType:()=>c,isPacketValid:()=>bt,protocol:()=>5}),pe=["connect","connect_error","disconnect","disconnecting","newListener","removeListener"],Tt=5,c;(function(e){e[e.CONNECT=0]="CONNECT",e[e.DISCONNECT=1]="DISCONNECT",e[e.EVENT=2]="EVENT",e[e.ACK=3]="ACK",e[e.CONNECT_ERROR=4]="CONNECT_ERROR",e[e.BINARY_EVENT=5]="BINARY_EVENT",e[e.BINARY_ACK=6]="BINARY_ACK"})(c||(c={}));var dt=class{constructor(e){this.replacer=e}encode(e){return(e.type===c.EVENT||e.type===c.ACK)&&O(e)?this.encodeAsBinary({type:e.type===c.EVENT?c.BINARY_EVENT:c.BINARY_ACK,nsp:e.nsp,data:e.data,id:e.id}):[this.encodeAsString(e)]}encodeAsString(e){let t=""+e.type;return(e.type===c.BINARY_EVENT||e.type===c.BINARY_ACK)&&(t+=e.attachments+"-"),e.nsp&&e.nsp!=="/"&&(t+=e.nsp+","),e.id!=null&&(t+=e.id),e.data!=null&&(t+=JSON.stringify(e.data,this.replacer)),t}encodeAsBinary(e){const t=ht(e),s=this.encodeAsString(t.packet),i=t.buffers;return i.unshift(s),i}},ft=class ve extends l{constructor(t){super(),this.opts=Object.assign({reviver:void 0,maxAttachments:10},typeof t=="function"?{reviver:t}:t)}add(t){let s;if(typeof t=="string"){if(this.reconstructor)throw new Error("got plaintext data when reconstructing a packet");s=this.decodeString(t);const i=s.type===c.BINARY_EVENT;i||s.type===c.BINARY_ACK?(s.type=i?c.EVENT:c.ACK,this.reconstructor=new pt(s),s.attachments===0&&super.emitReserved("decoded",s)):super.emitReserved("decoded",s)}else if(W(t)||t.base64)if(this.reconstructor)s=this.reconstructor.takeBinaryData(t),s&&(this.reconstructor=null,super.emitReserved("decoded",s));else throw new Error("got binary data when not reconstructing a packet");else throw new Error("Unknown type: "+t)}decodeString(t){let s=0;const i={type:Number(t.charAt(0))};if(c[i.type]===void 0)throw new Error("unknown packet type "+i.type);if(i.type===c.BINARY_EVENT||i.type===c.BINARY_ACK){const r=s+1;for(;t.charAt(++s)!=="-"&&s!=t.length;);const o=t.substring(r,s);if(o!=Number(o)||t.charAt(s)!=="-")throw new Error("Illegal attachments");const a=Number(o);if(!ge(a)||a<0)throw new Error("Illegal attachments");if(a>this.opts.maxAttachments)throw new Error("too many attachments");i.attachments=a}if(t.charAt(s+1)==="/"){const r=s+1;for(;++s&&!(t.charAt(s)===","||s===t.length););i.nsp=t.substring(r,s)}else i.nsp="/";const n=t.charAt(s+1);if(n!==""&&Number(n)==n){const r=s+1;for(;++s;){const o=t.charAt(s);if(o==null||Number(o)!=o){--s;break}if(s===t.length)break}i.id=Number(t.substring(r,s+1))}if(t.charAt(++s)){const r=this.tryParse(t.substr(s));if(ve.isPayloadValid(i.type,r))i.data=r;else throw new Error("invalid payload")}return i}tryParse(t){try{return JSON.parse(t,this.opts.reviver)}catch{return!1}}static isPayloadValid(t,s){switch(t){case c.CONNECT:return N(s);case c.DISCONNECT:return s===void 0;case c.CONNECT_ERROR:return typeof s=="string"||N(s);case c.EVENT:case c.BINARY_EVENT:return Array.isArray(s)&&(typeof s[0]=="number"||typeof s[0]=="string"&&pe.indexOf(s[0])===-1);case c.ACK:case c.BINARY_ACK:return Array.isArray(s)}}destroy(){this.reconstructor&&(this.reconstructor.finishedReconstruction(),this.reconstructor=null)}},pt=class{constructor(e){this.packet=e,this.buffers=[],this.reconPack=e}takeBinaryData(e){if(this.buffers.push(e),this.buffers.length===this.reconPack.attachments){const t=lt(this.reconPack,this.buffers);return this.finishedReconstruction(),t}return null}finishedReconstruction(){this.reconPack=null,this.buffers=[]}};function gt(e){return typeof e=="string"}var ge=Number.isInteger||function(e){return typeof e=="number"&&isFinite(e)&&Math.floor(e)===e};function mt(e){return e===void 0||ge(e)}function N(e){return Object.prototype.toString.call(e)==="[object Object]"}function yt(e,t){switch(e){case c.CONNECT:return t===void 0||N(t);case c.DISCONNECT:return t===void 0;case c.EVENT:return Array.isArray(t)&&(typeof t[0]=="number"||typeof t[0]=="string"&&pe.indexOf(t[0])===-1);case c.ACK:return Array.isArray(t);case c.CONNECT_ERROR:return typeof t=="string"||N(t);default:return!1}}function bt(e){return gt(e.nsp)&&mt(e.id)&&yt(e.type,e.data)}function p(e,t,s){return e.on(t,s),function(){e.off(t,s)}}var wt=Object.freeze({connect:1,connect_error:1,disconnect:1,disconnecting:1,newListener:1,removeListener:1}),me=class extends l{constructor(e,t,s){super(),this.connected=!1,this.recovered=!1,this.receiveBuffer=[],this.sendBuffer=[],this._queue=[],this._queueSeq=0,this.ids=0,this.acks={},this.flags={},this.io=e,this.nsp=t,s&&s.auth&&(this.auth=s.auth),this._opts=Object.assign({},s),this.io._autoConnect&&this.open()}get disconnected(){return!this.connected}subEvents(){if(this.subs)return;const e=this.io;this.subs=[p(e,"open",this.onopen.bind(this)),p(e,"packet",this.onpacket.bind(this)),p(e,"error",this.onerror.bind(this)),p(e,"close",this.onclose.bind(this))]}get active(){return!!this.subs}connect(){return this.connected?this:(this.subEvents(),this.io._reconnecting||this.io.open(),this.io._readyState==="open"&&this.onopen(),this)}open(){return this.connect()}send(...e){return e.unshift("message"),this.emit.apply(this,e),this}emit(e,...t){var s,i,n;if(wt.hasOwnProperty(e))throw new Error('"'+e.toString()+'" is a reserved event name');if(t.unshift(e),this._opts.retries&&!this.flags.fromQueue&&!this.flags.volatile)return this._addToQueue(t),this;const r={type:c.EVENT,data:t};if(r.options={},r.options.compress=this.flags.compress!==!1,typeof t[t.length-1]=="function"){const h=this.ids++,u=t.pop();this._registerAckCallback(h,u),r.id=h}const o=(i=(s=this.io.engine)===null||s===void 0?void 0:s.transport)===null||i===void 0?void 0:i.writable,a=this.connected&&!(!((n=this.io.engine)===null||n===void 0)&&n._hasPingExpired());return this.flags.volatile&&!o||(a?(this.notifyOutgoingListeners(r),this.packet(r)):this.sendBuffer.push(r)),this.flags={},this}_registerAckCallback(e,t){var s;const i=(s=this.flags.timeout)!==null&&s!==void 0?s:this._opts.ackTimeout;if(i===void 0){this.acks[e]=t;return}const n=this.io.setTimeoutFn(()=>{delete this.acks[e];for(let o=0;o<this.sendBuffer.length;o++)this.sendBuffer[o].id===e&&this.sendBuffer.splice(o,1);t.call(this,new Error("operation has timed out"))},i),r=(...o)=>{this.io.clearTimeoutFn(n),t.apply(this,o)};r.withError=!0,this.acks[e]=r}emitWithAck(e,...t){return new Promise((s,i)=>{const n=(r,o)=>r?i(r):s(o);n.withError=!0,t.push(n),this.emit(e,...t)})}_addToQueue(e){let t;typeof e[e.length-1]=="function"&&(t=e.pop());const s={id:this._queueSeq++,tryCount:0,pending:!1,args:e,flags:Object.assign({fromQueue:!0},this.flags)};e.push((i,...n)=>(this._queue[0],i!==null?s.tryCount>this._opts.retries&&(this._queue.shift(),t&&t(i)):(this._queue.shift(),t&&t(null,...n)),s.pending=!1,this._drainQueue())),this._queue.push(s),this._drainQueue()}_drainQueue(e=!1){if(!this.connected||this._queue.length===0)return;const t=this._queue[0];t.pending&&!e||(t.pending=!0,t.tryCount++,this.flags=t.flags,this.emit.apply(this,t.args))}packet(e){e.nsp=this.nsp,this.io._packet(e)}onopen(){typeof this.auth=="function"?this.auth(e=>{this._sendConnectPacket(e)}):this._sendConnectPacket(this.auth)}_sendConnectPacket(e){this.packet({type:c.CONNECT,data:this._pid?Object.assign({pid:this._pid,offset:this._lastOffset},e):e})}onerror(e){this.connected||this.emitReserved("connect_error",e)}onclose(e,t){this.connected=!1,delete this.id,this.emitReserved("disconnect",e,t),this._clearAcks()}_clearAcks(){Object.keys(this.acks).forEach(e=>{if(!this.sendBuffer.some(t=>String(t.id)===e)){const t=this.acks[e];delete this.acks[e],t.withError&&t.call(this,new Error("socket has been disconnected"))}})}onpacket(e){if(e.nsp===this.nsp)switch(e.type){case c.CONNECT:e.data&&e.data.sid?this.onconnect(e.data.sid,e.data.pid):this.emitReserved("connect_error",new Error("It seems you are trying to reach a Socket.IO server in v2.x with a v3.x client, but they are not compatible (more information here: https://socket.io/docs/v3/migrating-from-2-x-to-3-0/)"));break;case c.EVENT:case c.BINARY_EVENT:this.onevent(e);break;case c.ACK:case c.BINARY_ACK:this.onack(e);break;case c.DISCONNECT:this.ondisconnect();break;case c.CONNECT_ERROR:this.destroy();const t=new Error(e.data.message);t.data=e.data.data,this.emitReserved("connect_error",t);break}}onevent(e){const t=e.data||[];e.id!=null&&t.push(this.ack(e.id)),this.connected?this.emitEvent(t):this.receiveBuffer.push(Object.freeze(t))}emitEvent(e){if(this._anyListeners&&this._anyListeners.length){const t=this._anyListeners.slice();for(const s of t)s.apply(this,e)}super.emit.apply(this,e),this._pid&&e.length&&typeof e[e.length-1]=="string"&&(this._lastOffset=e[e.length-1])}ack(e){const t=this;let s=!1;return function(...i){s||(s=!0,t.packet({type:c.ACK,id:e,data:i}))}}onack(e){const t=this.acks[e.id];typeof t=="function"&&(delete this.acks[e.id],t.withError&&e.data.unshift(null),t.apply(this,e.data))}onconnect(e,t){this.id=e,this.recovered=t&&this._pid===t,this._pid=t,this.connected=!0,this.emitBuffered(),this._drainQueue(!0),this.emitReserved("connect")}emitBuffered(){this.receiveBuffer.forEach(e=>this.emitEvent(e)),this.receiveBuffer=[],this.sendBuffer.forEach(e=>{this.notifyOutgoingListeners(e),this.packet(e)}),this.sendBuffer=[]}ondisconnect(){this.destroy(),this.onclose("io server disconnect")}destroy(){this.subs&&(this.subs.forEach(e=>e()),this.subs=void 0),this.io._destroy(this)}disconnect(){return this.connected&&this.packet({type:c.DISCONNECT}),this.destroy(),this.connected&&this.onclose("io client disconnect"),this}close(){return this.disconnect()}compress(e){return this.flags.compress=e,this}get volatile(){return this.flags.volatile=!0,this}timeout(e){return this.flags.timeout=e,this}onAny(e){return this._anyListeners=this._anyListeners||[],this._anyListeners.push(e),this}prependAny(e){return this._anyListeners=this._anyListeners||[],this._anyListeners.unshift(e),this}offAny(e){if(!this._anyListeners)return this;if(e){const t=this._anyListeners;for(let s=0;s<t.length;s++)if(e===t[s])return t.splice(s,1),this}else this._anyListeners=[];return this}listenersAny(){return this._anyListeners||[]}onAnyOutgoing(e){return this._anyOutgoingListeners=this._anyOutgoingListeners||[],this._anyOutgoingListeners.push(e),this}prependAnyOutgoing(e){return this._anyOutgoingListeners=this._anyOutgoingListeners||[],this._anyOutgoingListeners.unshift(e),this}offAnyOutgoing(e){if(!this._anyOutgoingListeners)return this;if(e){const t=this._anyOutgoingListeners;for(let s=0;s<t.length;s++)if(e===t[s])return t.splice(s,1),this}else this._anyOutgoingListeners=[];return this}listenersAnyOutgoing(){return this._anyOutgoingListeners||[]}notifyOutgoingListeners(e){if(this._anyOutgoingListeners&&this._anyOutgoingListeners.length){const t=this._anyOutgoingListeners.slice();for(const s of t)s.apply(this,e.data)}}};function x(e){e=e||{},this.ms=e.min||100,this.max=e.max||1e4,this.factor=e.factor||2,this.jitter=e.jitter>0&&e.jitter<=1?e.jitter:0,this.attempts=0}x.prototype.duration=function(){var e=this.ms*Math.pow(this.factor,this.attempts++);if(this.jitter){var t=Math.random(),s=Math.floor(t*this.jitter*e);e=(Math.floor(t*10)&1)==0?e-s:e+s}return Math.min(e,this.max)|0},x.prototype.reset=function(){this.attempts=0},x.prototype.setMin=function(e){this.ms=e},x.prototype.setMax=function(e){this.max=e},x.prototype.setJitter=function(e){this.jitter=e};var Y=class extends l{constructor(e,t){var s;super(),this.nsps={},this.subs=[],e&&typeof e=="object"&&(t=e,e=void 0),t=t||{},t.path=t.path||"/socket.io",this.opts=t,A(this,t),this.reconnection(t.reconnection!==!1),this.reconnectionAttempts(t.reconnectionAttempts||1/0),this.reconnectionDelay(t.reconnectionDelay||1e3),this.reconnectionDelayMax(t.reconnectionDelayMax||5e3),this.randomizationFactor((s=t.randomizationFactor)!==null&&s!==void 0?s:.5),this.backoff=new x({min:this.reconnectionDelay(),max:this.reconnectionDelayMax(),jitter:this.randomizationFactor()}),this.timeout(t.timeout==null?2e4:t.timeout),this._readyState="closed",this.uri=e;const i=t.parser||ut;this.encoder=new i.Encoder,this.decoder=new i.Decoder,this._autoConnect=t.autoConnect!==!1,this._autoConnect&&this.open()}reconnection(e){return arguments.length?(this._reconnection=!!e,e||(this.skipReconnect=!0),this):this._reconnection}reconnectionAttempts(e){return e===void 0?this._reconnectionAttempts:(this._reconnectionAttempts=e,this)}reconnectionDelay(e){var t;return e===void 0?this._reconnectionDelay:(this._reconnectionDelay=e,(t=this.backoff)===null||t===void 0||t.setMin(e),this)}randomizationFactor(e){var t;return e===void 0?this._randomizationFactor:(this._randomizationFactor=e,(t=this.backoff)===null||t===void 0||t.setJitter(e),this)}reconnectionDelayMax(e){var t;return e===void 0?this._reconnectionDelayMax:(this._reconnectionDelayMax=e,(t=this.backoff)===null||t===void 0||t.setMax(e),this)}timeout(e){return arguments.length?(this._timeout=e,this):this._timeout}maybeReconnectOnOpen(){!this._reconnecting&&this._reconnection&&this.backoff.attempts===0&&this.reconnect()}open(e){if(~this._readyState.indexOf("open"))return this;this.engine=new de(this.uri,this.opts);const t=this.engine,s=this;this._readyState="opening",this.skipReconnect=!1;const i=p(t,"open",function(){s.onopen(),e&&e()}),n=o=>{this.cleanup(),this._readyState="closed",this.emitReserved("error",o),e?e(o):this.maybeReconnectOnOpen()},r=p(t,"error",n);if(this._timeout!==!1){const o=this._timeout,a=this.setTimeoutFn(()=>{i(),n(new Error("timeout")),t.close()},o);this.opts.autoUnref&&a.unref(),this.subs.push(()=>{this.clearTimeoutFn(a)})}return this.subs.push(i),this.subs.push(r),this}connect(e){return this.open(e)}onopen(){this.cleanup(),this._readyState="open",this.emitReserved("open");const e=this.engine;this.subs.push(p(e,"ping",this.onping.bind(this)),p(e,"data",this.ondata.bind(this)),p(e,"error",this.onerror.bind(this)),p(e,"close",this.onclose.bind(this)),p(this.decoder,"decoded",this.ondecoded.bind(this)))}onping(){this.emitReserved("ping")}ondata(e){try{this.decoder.add(e)}catch(t){this.onclose("parse error",t)}}ondecoded(e){T(()=>{this.emitReserved("packet",e)},this.setTimeoutFn)}onerror(e){this.emitReserved("error",e)}socket(e,t){let s=this.nsps[e];return s?this._autoConnect&&!s.active&&s.connect():(s=new me(this,e,t),this.nsps[e]=s),s}_destroy(e){const t=Object.keys(this.nsps);for(const s of t)if(this.nsps[s].active)return;this._close()}_packet(e){const t=this.encoder.encode(e);for(let s=0;s<t.length;s++)this.engine.write(t[s],e.options)}cleanup(){this.subs.forEach(e=>e()),this.subs.length=0,this.decoder.destroy()}_close(){this.skipReconnect=!0,this._reconnecting=!1,this.onclose("forced close")}disconnect(){return this._close()}onclose(e,t){var s;this.cleanup(),(s=this.engine)===null||s===void 0||s.close(),this.backoff.reset(),this._readyState="closed",this.emitReserved("close",e,t),this._reconnection&&!this.skipReconnect&&this.reconnect()}reconnect(){if(this._reconnecting||this.skipReconnect)return this;const e=this;if(this.backoff.attempts>=this._reconnectionAttempts)this.backoff.reset(),this.emitReserved("reconnect_failed"),this._reconnecting=!1;else{const t=this.backoff.duration();this._reconnecting=!0;const s=this.setTimeoutFn(()=>{e.skipReconnect||(this.emitReserved("reconnect_attempt",e.backoff.attempts),!e.skipReconnect&&e.open(i=>{i?(e._reconnecting=!1,e.reconnect(),this.emitReserved("reconnect_error",i)):e.onreconnect()}))},t);this.opts.autoUnref&&s.unref(),this.subs.push(()=>{this.clearTimeoutFn(s)})}}onreconnect(){const e=this.backoff.attempts;this._reconnecting=!1,this.backoff.reset(),this.emitReserved("reconnect",e)}},_={};function L(e,t){typeof e=="object"&&(t=e,e=void 0),t=t||{};const s=nt(e,t.path||"/socket.io"),i=s.source,n=s.id,r=s.path,o=_[n]&&r in _[n].nsps,a=t.forceNew||t["force new connection"]||t.multiplex===!1||o;let h;return a?h=new Y(i,t):(_[n]||(_[n]=new Y(i,t)),h=_[n]),s.query&&!t.query&&(t.query=s.queryKey),h.socket(s.path,t)}Object.assign(L,{Manager:Y,Socket:me,io:L,connect:L});var xt=class _e{static{this.MAX_QUEUE_SIZE=50}constructor(t,s={}){this.socket=null,this.state="disconnected",this.messageHandlers=[],this.audioHandlers=[],this.stateHandlers=[],this.agentStatusHandlers=[],this.streamDeltaHandlers=[],this.offlineQueue=[],this.serverUrl=t.replace(/\/$/,""),this.options=s}connect(){return new Promise((t,s)=>{if(this.socket?.connected){t();return}this._setState("connecting");const i={};this.options.apiKey&&(i.authorization=`Bearer ${this.options.apiKey}`),this.socket=L(`${this.serverUrl}/space`,{transports:["websocket","polling"],auth:i,reconnection:!0,reconnectionAttempts:5,reconnectionDelay:1e3,reconnectionDelayMax:5e3,timeout:1e4});const n=()=>{this._setState("connected"),this.socket.emit("joinRoom",{roomId:this.options.roomId||"default"}),t()},r=o=>{this._setState("error"),s(o)};this.socket.once("connect",n),this.socket.once("connect_error",r),this.socket.on("disconnect",()=>{this._setState("disconnected")}),this.socket.on("reconnect",()=>{this._setState("connected"),this.socket.emit("joinRoom",{roomId:this.options.roomId||"default"}),this.flushOfflineQueue()}),this.socket.on("textComplete",o=>{this.messageHandlers.forEach(a=>a(o))}),this.socket.on("userMessage",o=>{this.messageHandlers.forEach(a=>a(o))}),this.socket.on("messageHistory",o=>{o.forEach(a=>this.messageHandlers.forEach(h=>h(a)))}),this.socket.on("ttsAudio",({agentId:o,audio:a,format:h})=>{this.audioHandlers.forEach(u=>u(a,h,o))}),this.socket.on("agentStatus",({agentId:o,status:a,name:h})=>{this.agentStatusHandlers.forEach(u=>u(o,a,h))}),this.socket.on("textDelta",({agentId:o,delta:a,messageId:h})=>{this.streamDeltaHandlers.forEach(u=>u(o,a,h))}),this.socket.on("error",o=>{console.warn("[XSpaceWidget] Server error:",o.message)})})}disconnect(){this.socket&&(this.socket.disconnect(),this.socket=null),this._setState("disconnected")}sendMessage(t){if(!this.socket?.connected){this.offlineQueue.length<_e.MAX_QUEUE_SIZE&&this.offlineQueue.push({text:t});return}this.socket.emit("userMessage",{text:t,from:this.options.userName||"User"})}flushOfflineQueue(){const t=this.offlineQueue.splice(0);for(const s of t)this.sendMessage(s.text)}sendAudio(t,s="audio/webm"){if(!this.socket?.connected)return;const i=this.options.agentId;if(!i)return;const n=new Uint8Array(t);let r="";for(let a=0;a<n.length;a++)r+=String.fromCharCode(n[a]);const o=btoa(r);this.socket.emit("audioData",{agentId:i,audio:o,mimeType:s})}onAgentMessage(t){this.messageHandlers.push(t)}onAgentAudio(t){this.audioHandlers.push(t)}onStateChange(t){this.stateHandlers.push(t)}onAgentStatus(t){this.agentStatusHandlers.push(t)}onStreamDelta(t){this.streamDeltaHandlers.push(t)}getState(){return this.state}_setState(t){this.state=t,this.stateHandlers.forEach(s=>s(t))}},Q={primaryColor:"#1d9bf0",primaryHoverColor:"#1a8cd8",backgroundColor:"#ffffff",surfaceColor:"#f7f9fa",textColor:"#0f1419",textSecondaryColor:"#536471",userBubbleColor:"#1d9bf0",userBubbleTextColor:"#ffffff",agentBubbleColor:"#eff3f4",agentBubbleTextColor:"#0f1419",borderColor:"#cfd9de",inputBackgroundColor:"#eff3f4",inputTextColor:"#0f1419",shadowColor:"rgba(0,0,0,0.15)",fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',borderRadius:"16px",bubbleBorderRadius:"12px"},J={primaryColor:"#1d9bf0",primaryHoverColor:"#1a8cd8",backgroundColor:"#15202b",surfaceColor:"#1e2732",textColor:"#d9d9d9",textSecondaryColor:"#8b98a5",userBubbleColor:"#1d9bf0",userBubbleTextColor:"#ffffff",agentBubbleColor:"#273340",agentBubbleTextColor:"#d9d9d9",borderColor:"#38444d",inputBackgroundColor:"#273340",inputTextColor:"#d9d9d9",shadowColor:"rgba(0,0,0,0.5)",fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',borderRadius:"16px",bubbleBorderRadius:"12px"};function vt(e,t){let s;return e==="auto"?s=window.matchMedia("(prefers-color-scheme: dark)").matches?J:Q:s=e==="dark"?J:Q,t?{...s,...t}:s}function _t(e,t){const s=window.matchMedia("(prefers-color-scheme: dark)"),i=()=>{const n=s.matches?J:Q;e(t?{...n,...t}:n,t)};return s.addEventListener("change",i),()=>s.removeEventListener("change",i)}function ye(e){return`
    :host {
      --xw-primary: ${e.primaryColor};
      --xw-primary-hover: ${e.primaryHoverColor};
      --xw-bg: ${e.backgroundColor};
      --xw-surface: ${e.surfaceColor};
      --xw-text: ${e.textColor};
      --xw-text-secondary: ${e.textSecondaryColor};
      --xw-user-bubble: ${e.userBubbleColor};
      --xw-user-bubble-text: ${e.userBubbleTextColor};
      --xw-agent-bubble: ${e.agentBubbleColor};
      --xw-agent-bubble-text: ${e.agentBubbleTextColor};
      --xw-border: ${e.borderColor};
      --xw-input-bg: ${e.inputBackgroundColor};
      --xw-input-text: ${e.inputTextColor};
      --xw-shadow: ${e.shadowColor};
      --xw-font: ${e.fontFamily};
      --xw-radius: ${e.borderRadius};
      --xw-bubble-radius: ${e.bubbleBorderRadius};
    }
  `}var be=class{constructor(){this.mediaRecorder=null,this.stream=null,this.chunks=[],this.state="idle",this.stateHandlers=[]}async start(){if(this.state!=="recording")try{this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:!0,noiseSuppression:!0,sampleRate:16e3}});const e=this.getSupportedMimeType();this.mediaRecorder=new MediaRecorder(this.stream,{mimeType:e,audioBitsPerSecond:64e3}),this.chunks=[],this.mediaRecorder.ondataavailable=t=>{t.data.size>0&&this.chunks.push(t.data)},this.mediaRecorder.start(250),this.setState("recording")}catch{throw this.setState("error"),new Error("Microphone access denied")}}async stop(){return this.state!=="recording"||!this.mediaRecorder?null:new Promise(e=>{this.mediaRecorder.onstop=async()=>{const t=this.mediaRecorder.mimeType,s=await new Blob(this.chunks,{type:t}).arrayBuffer();this.cleanup(),this.setState("idle"),e({buffer:s,mimeType:t})},this.mediaRecorder.stop()})}cancel(){this.mediaRecorder&&this.state==="recording"&&this.mediaRecorder.stop(),this.cleanup(),this.setState("idle")}isRecording(){return this.state==="recording"}getState(){return this.state}onStateChange(e){this.stateHandlers.push(e)}destroy(){this.cancel(),this.stateHandlers=[]}static isSupported(){return!!(navigator.mediaDevices?.getUserMedia&&window.MediaRecorder)}setState(e){this.state=e,this.stateHandlers.forEach(t=>t(e))}cleanup(){this.stream&&(this.stream.getTracks().forEach(e=>e.stop()),this.stream=null),this.mediaRecorder=null,this.chunks=[]}getSupportedMimeType(){for(const e of["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/mp4"])if(MediaRecorder.isTypeSupported(e))return e;return"audio/webm"}},Et=class{constructor(){this.audioContext=null,this.queue=[],this.playing=!1}async play(e,t){const s=this.base64ToArrayBuffer(e);this.queue.push(s),this.playing||await this.processQueue(t)}stop(){this.queue=[],this.playing=!1}destroy(){this.stop(),this.audioContext&&(this.audioContext.close(),this.audioContext=null)}async processQueue(e){this.playing=!0;const t=this.getContext();for(;this.queue.length>0;){const s=this.queue.shift();try{const i=await t.decodeAudioData(s.slice(0));await this.playBuffer(t,i)}catch{}}this.playing=!1}playBuffer(e,t){return new Promise(s=>{const i=e.createBufferSource();i.buffer=t,i.connect(e.destination),i.onended=()=>s(),i.start(0)})}getContext(){return this.audioContext||(this.audioContext=new AudioContext),this.audioContext.state==="suspended"&&this.audioContext.resume(),this.audioContext}base64ToArrayBuffer(e){const t=atob(e),s=new Uint8Array(t.length);for(let i=0;i<t.length;i++)s[i]=t.charCodeAt(i);return s.buffer}},we=`
  :host {
    all: initial;
    font-family: var(--xw-font);
    color: var(--xw-text);
    font-size: 14px;
    line-height: 1.4;
    box-sizing: border-box;
  }

  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  .xw-container {
    position: fixed;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 12px;
    pointer-events: none;
  }

  .xw-container--bottom-right { bottom: 20px; right: 20px; }
  .xw-container--bottom-left  { bottom: 20px; left: 20px; align-items: flex-start; }
  .xw-container--top-right    { top: 20px; right: 20px; }
  .xw-container--top-left     { top: 20px; left: 20px; align-items: flex-start; }

  .xw-container > * {
    pointer-events: auto;
  }

  /* Floating button */
  .xw-fab {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--xw-primary);
    color: #fff;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px var(--xw-shadow);
    transition: background 0.2s, transform 0.15s;
    outline: none;
  }

  .xw-fab:hover { background: var(--xw-primary-hover); transform: scale(1.05); }
  .xw-fab:focus-visible { box-shadow: 0 0 0 3px var(--xw-primary), 0 4px 12px var(--xw-shadow); }
  .xw-fab svg { width: 24px; height: 24px; fill: currentColor; }

  /* Panel */
  .xw-panel {
    width: 380px;
    max-width: calc(100vw - 40px);
    height: 520px;
    max-height: calc(100vh - 120px);
    background: var(--xw-bg);
    border-radius: var(--xw-radius);
    box-shadow: 0 8px 32px var(--xw-shadow);
    display: none;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--xw-border);
    animation: xw-slide-in 0.2s ease-out;
  }

  .xw-panel--open { display: flex; }

  @keyframes xw-slide-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Header */
  .xw-header {
    display: flex;
    align-items: center;
    padding: 14px 16px;
    background: var(--xw-primary);
    color: #fff;
    gap: 10px;
    flex-shrink: 0;
  }

  .xw-header__title {
    flex: 1;
    font-weight: 600;
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .xw-header__status {
    font-size: 11px;
    opacity: 0.85;
  }

  .xw-header__close {
    width: 28px;
    height: 28px;
    border: none;
    background: rgba(255,255,255,0.2);
    color: #fff;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
    outline: none;
    flex-shrink: 0;
  }

  .xw-header__close:hover { background: rgba(255,255,255,0.3); }
  .xw-header__close:focus-visible { box-shadow: 0 0 0 2px #fff; }
  .xw-header__close svg { width: 14px; height: 14px; fill: currentColor; }

  /* Messages area */
  .xw-messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    scroll-behavior: smooth;
  }

  .xw-messages::-webkit-scrollbar { width: 4px; }
  .xw-messages::-webkit-scrollbar-thumb { background: var(--xw-border); border-radius: 2px; }

  .xw-greeting {
    text-align: center;
    color: var(--xw-text-secondary);
    padding: 24px 16px;
    font-size: 13px;
  }

  /* Message bubble */
  .xw-bubble {
    max-width: 80%;
    padding: 10px 14px;
    border-radius: var(--xw-bubble-radius);
    word-wrap: break-word;
    white-space: pre-wrap;
    font-size: 14px;
    line-height: 1.45;
  }

  .xw-bubble--user {
    align-self: flex-end;
    background: var(--xw-user-bubble);
    color: var(--xw-user-bubble-text);
    border-bottom-right-radius: 4px;
  }

  .xw-bubble--agent {
    align-self: flex-start;
    background: var(--xw-agent-bubble);
    color: var(--xw-agent-bubble-text);
    border-bottom-left-radius: 4px;
  }

  .xw-bubble__name {
    font-size: 11px;
    font-weight: 600;
    margin-bottom: 4px;
    opacity: 0.8;
  }

  .xw-bubble__time {
    font-size: 10px;
    opacity: 0.6;
    margin-top: 4px;
    text-align: right;
  }

  /* Typing indicator */
  .xw-typing {
    align-self: flex-start;
    padding: 10px 14px;
    background: var(--xw-agent-bubble);
    border-radius: var(--xw-bubble-radius);
    display: none;
    gap: 4px;
    align-items: center;
  }

  .xw-typing--visible { display: flex; }

  .xw-typing__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--xw-text-secondary);
    animation: xw-bounce 1.2s infinite;
  }
  .xw-typing__dot:nth-child(2) { animation-delay: 0.2s; }
  .xw-typing__dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes xw-bounce {
    0%, 60%, 100% { transform: translateY(0); }
    30% { transform: translateY(-4px); }
  }

  /* Input area */
  .xw-input-area {
    display: flex;
    align-items: flex-end;
    padding: 12px;
    gap: 8px;
    border-top: 1px solid var(--xw-border);
    background: var(--xw-bg);
    flex-shrink: 0;
  }

  .xw-input {
    flex: 1;
    min-height: 38px;
    max-height: 100px;
    padding: 8px 12px;
    border: 1px solid var(--xw-border);
    border-radius: 20px;
    background: var(--xw-input-bg);
    color: var(--xw-input-text);
    font-family: var(--xw-font);
    font-size: 14px;
    resize: none;
    outline: none;
    overflow-y: auto;
    line-height: 1.4;
  }

  .xw-input::placeholder { color: var(--xw-text-secondary); }
  .xw-input:focus { border-color: var(--xw-primary); }

  .xw-send-btn, .xw-voice-btn {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, transform 0.1s;
    outline: none;
    flex-shrink: 0;
  }

  .xw-send-btn {
    background: var(--xw-primary);
    color: #fff;
  }

  .xw-send-btn:hover { background: var(--xw-primary-hover); }
  .xw-send-btn:focus-visible { box-shadow: 0 0 0 2px var(--xw-primary); }
  .xw-send-btn:disabled { opacity: 0.5; cursor: default; }
  .xw-send-btn svg { width: 18px; height: 18px; fill: currentColor; }

  .xw-voice-btn {
    background: var(--xw-surface);
    color: var(--xw-text);
    border: 1px solid var(--xw-border);
  }

  .xw-voice-btn:hover { background: var(--xw-border); }
  .xw-voice-btn:focus-visible { box-shadow: 0 0 0 2px var(--xw-primary); }
  .xw-voice-btn--recording {
    background: #e0245e;
    color: #fff;
    border-color: #e0245e;
    animation: xw-pulse 1.5s infinite;
  }
  .xw-voice-btn svg { width: 18px; height: 18px; fill: currentColor; }

  @keyframes xw-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(224,36,94,0.4); }
    50% { box-shadow: 0 0 0 8px rgba(224,36,94,0); }
  }

  /* Connection status bar */
  .xw-status-bar {
    font-size: 11px;
    text-align: center;
    padding: 4px;
    background: var(--xw-surface);
    color: var(--xw-text-secondary);
    display: none;
    flex-shrink: 0;
  }

  .xw-status-bar--visible { display: block; }

  /* Screen reader only */
  .xw-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0,0,0,0);
    border: 0;
  }

  @media (max-width: 480px) {
    .xw-panel {
      width: calc(100vw - 20px);
      height: calc(100vh - 80px);
      border-radius: 12px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .xw-panel { animation: none; }
    .xw-typing__dot { animation: none; }
    .xw-voice-btn--recording { animation: none; }
    .xw-fab { transition: none; }
    .xw-fab:hover { transform: none; }
    .xw-send-btn, .xw-voice-btn, .xw-header__close { transition: none; }
    .xw-messages { scroll-behavior: auto; }
  }
`,m={chat:'<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/><path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg>',close:'<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',send:'<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',mic:'<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>',stop:'<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M6 6h12v12H6z"/></svg>'},j=class{constructor(e){if(this.voiceInput=null,this.shadowRoot=null,this.hostEl=null,this.isOpen=!1,this.mounted=!1,this.themeCleanup=null,this.escapeHandler=null,this.streamingMessages=new Map,!e.serverUrl)throw new Error("XSpaceWidget: serverUrl is required");this.config={position:"bottom-right",theme:"light",greeting:"Hello! How can I help you?",placeholder:"Type a message...",title:"Chat",enableVoice:!0,enableText:!0,persistMessages:!0,...e},this.connection=new xt(e.serverUrl,{agentId:e.agentId,roomId:e.roomId,apiKey:e.apiKey,userName:e.userName}),this.audioPlayer=new Et,this.config.enableVoice&&be.isSupported()&&(this.voiceInput=new be),this.setupConnectionHandlers()}mount(e){if(this.mounted)return;this.hostEl=document.createElement("div"),this.hostEl.id="xspace-widget-host",this.shadowRoot=this.hostEl.attachShadow({mode:"open"});const t=vt(this.config.theme,this.config.customTheme),s=document.createElement("style");s.textContent=ye(t)+we,this.shadowRoot.appendChild(s),this.buildDOM(),(e||document.body).appendChild(this.hostEl),this.mounted=!0,this.loadPersistedMessages(),this.config.theme==="auto"&&(this.themeCleanup=_t(i=>{if(this.shadowRoot){const n=this.shadowRoot.querySelector("style");n&&(n.textContent=ye(i)+we)}},this.config.customTheme)),this.escapeHandler=i=>{i.key==="Escape"&&this.isOpen&&this.close()},document.addEventListener("keydown",this.escapeHandler),this.connection.connect().catch(i=>{console.warn("[XSpaceWidget] Connection failed:",i.message)})}unmount(){this.mounted&&(this.connection.disconnect(),this.hostEl?.remove(),this.hostEl=null,this.shadowRoot=null,this.mounted=!1)}open(){this.mounted&&(this.isOpen=!0,this.panel.classList.add("xw-panel--open"),this.fab.setAttribute("aria-expanded","true"),this.fab.innerHTML=m.close,this.inputEl?.focus(),this.scrollToBottom())}close(){this.mounted&&(this.isOpen=!1,this.panel.classList.remove("xw-panel--open"),this.fab.setAttribute("aria-expanded","false"),this.fab.innerHTML=m.chat)}toggle(){this.isOpen?this.close():this.open()}sendMessage(e){const t=e.trim();if(!t)return;this.connection.sendMessage(t);const s={id:crypto.randomUUID(),text:t,isUser:!0,name:this.config.userName||"You",agentId:"",timestamp:Date.now()};this.addMessage(s),this.persistMessage(s)}destroy(){this.unmount(),this.themeCleanup?.(),this.themeCleanup=null,this.escapeHandler&&(document.removeEventListener("keydown",this.escapeHandler),this.escapeHandler=null),this.voiceInput?.destroy(),this.audioPlayer.destroy()}clearHistory(){const e=this.persistenceKey();if(e)try{localStorage.removeItem(e)}catch{}}persistenceKey(){return this.config.persistMessages?`xspace-widget-${this.config.agentId||"default"}`:null}persistMessage(e){const t=this.persistenceKey();if(t)try{const s=JSON.parse(localStorage.getItem(t)||"[]");s.push(e),s.length>200&&s.splice(0,s.length-200),localStorage.setItem(t,JSON.stringify(s))}catch{}}loadPersistedMessages(){const e=this.persistenceKey();if(e)try{const t=JSON.parse(localStorage.getItem(e)||"[]");for(const s of t)this.addMessage(s)}catch{}}isConnected(){return this.connection.getState()==="connected"}setupConnectionHandlers(){this.connection.onAgentMessage(e=>{this.streamingMessages.has(e.id)&&(this.streamingMessages.get(e.id).remove(),this.streamingMessages.delete(e.id)),e.isUser||(this.addMessage(e),this.persistMessage(e)),this.config.onMessage?.(e)}),this.connection.onStreamDelta((e,t,s)=>{this.handleStreamDelta(e,t,s)}),this.connection.onAgentAudio((e,t)=>{this.audioPlayer.play(e,t)}),this.connection.onAgentStatus((e,t)=>{this.setTyping(t==="thinking"||t==="speaking")}),this.connection.onStateChange(e=>{this.updateConnectionStatus(e),e==="connected"&&this.config.onConnect?.(),e==="disconnected"&&this.config.onDisconnect?.()})}buildDOM(){if(!this.shadowRoot)return;const e=document.createElement("div");e.className=`xw-container xw-container--${this.config.position}`,e.setAttribute("role","region"),e.setAttribute("aria-label","Chat widget"),this.panel=document.createElement("div"),this.panel.className="xw-panel",this.panel.setAttribute("role","dialog"),this.panel.setAttribute("aria-label",this.config.title);const t=document.createElement("div");if(t.className="xw-header",t.innerHTML=`
      <span class="xw-header__title">${this.escapeHTML(this.config.title)}</span>
      <span class="xw-header__status" aria-live="polite"></span>
      <button class="xw-header__close" aria-label="Close chat">
        ${m.close}
      </button>
    `,t.querySelector(".xw-header__close").addEventListener("click",()=>this.close()),this.panel.appendChild(t),this.statusBar=document.createElement("div"),this.statusBar.className="xw-status-bar",this.statusBar.setAttribute("aria-live","polite"),this.panel.appendChild(this.statusBar),this.messagesEl=document.createElement("div"),this.messagesEl.className="xw-messages",this.messagesEl.setAttribute("role","log"),this.messagesEl.setAttribute("aria-label","Chat messages"),this.messagesEl.setAttribute("aria-live","polite"),this.config.greeting){const s=document.createElement("div");s.className="xw-greeting",s.textContent=this.config.greeting,this.messagesEl.appendChild(s)}if(this.typingEl=document.createElement("div"),this.typingEl.className="xw-typing",this.typingEl.setAttribute("aria-label","Agent is typing"),this.typingEl.innerHTML=`
      <div class="xw-typing__dot"></div>
      <div class="xw-typing__dot"></div>
      <div class="xw-typing__dot"></div>
    `,this.messagesEl.appendChild(this.typingEl),this.panel.appendChild(this.messagesEl),this.config.enableText||this.config.enableVoice){const s=document.createElement("div");s.className="xw-input-area",this.config.enableText&&(this.inputEl=document.createElement("textarea"),this.inputEl.className="xw-input",this.inputEl.placeholder=this.config.placeholder,this.inputEl.rows=1,this.inputEl.setAttribute("aria-label","Message input"),this.inputEl.addEventListener("keydown",i=>{i.key==="Enter"&&!i.shiftKey&&(i.preventDefault(),this.handleSend())}),this.inputEl.addEventListener("input",()=>this.autoResizeInput()),s.appendChild(this.inputEl)),this.config.enableVoice&&this.voiceInput&&(this.voiceBtn=document.createElement("button"),this.voiceBtn.className="xw-voice-btn",this.voiceBtn.setAttribute("aria-label","Voice input"),this.voiceBtn.innerHTML=m.mic,this.voiceBtn.addEventListener("click",()=>this.handleVoiceToggle()),this.voiceInput.onStateChange(i=>{this.voiceBtn&&(i==="recording"?(this.voiceBtn.classList.add("xw-voice-btn--recording"),this.voiceBtn.innerHTML=m.stop,this.voiceBtn.setAttribute("aria-label","Stop recording")):(this.voiceBtn.classList.remove("xw-voice-btn--recording"),this.voiceBtn.innerHTML=m.mic,this.voiceBtn.setAttribute("aria-label","Voice input")))}),s.appendChild(this.voiceBtn)),this.config.enableText&&(this.sendBtn=document.createElement("button"),this.sendBtn.className="xw-send-btn",this.sendBtn.setAttribute("aria-label","Send message"),this.sendBtn.innerHTML=m.send,this.sendBtn.addEventListener("click",()=>this.handleSend()),s.appendChild(this.sendBtn)),this.panel.appendChild(s)}e.appendChild(this.panel),this.fab=document.createElement("button"),this.fab.className="xw-fab",this.fab.setAttribute("aria-label","Open chat"),this.fab.setAttribute("aria-expanded","false"),this.fab.setAttribute("aria-haspopup","dialog"),this.fab.innerHTML=m.chat,this.fab.addEventListener("click",()=>this.toggle()),e.appendChild(this.fab),this.shadowRoot.appendChild(e)}handleSend(){if(!this.inputEl)return;const e=this.inputEl.value.trim();e&&(this.sendMessage(e),this.inputEl.value="",this.autoResizeInput(),this.inputEl.focus())}async handleVoiceToggle(){if(this.voiceInput)if(this.voiceInput.isRecording()){const e=await this.voiceInput.stop();e&&this.connection.sendAudio(e.buffer,e.mimeType)}else try{await this.voiceInput.start()}catch(e){console.warn("[XSpaceWidget] Voice input error:",e)}}addMessage(e){if(!this.messagesEl)return;const t=document.createElement("div");if(t.className=`xw-bubble ${e.isUser?"xw-bubble--user":"xw-bubble--agent"}`,t.setAttribute("role","article"),!e.isUser&&e.name){const n=document.createElement("div");n.className="xw-bubble__name",n.textContent=e.name,t.appendChild(n)}const s=document.createElement("div");s.textContent=e.text,t.appendChild(s);const i=document.createElement("div");i.className="xw-bubble__time",i.textContent=this.formatTime(e.timestamp),t.appendChild(i),this.messagesEl.insertBefore(t,this.typingEl),this.scrollToBottom()}handleStreamDelta(e,t,s){if(!this.messagesEl)return;let i=this.streamingMessages.get(s);if(!i){i=document.createElement("div"),i.className="xw-bubble xw-bubble--agent",i.setAttribute("role","article");const r=document.createElement("div");r.className="xw-bubble__name",r.textContent=e,i.appendChild(r);const o=document.createElement("div");o.dataset.streamText="true",i.appendChild(o),this.messagesEl.insertBefore(i,this.typingEl),this.streamingMessages.set(s,i)}const n=i.querySelector("[data-stream-text]");n&&(n.textContent+=t),this.scrollToBottom()}setTyping(e){this.typingEl&&(this.typingEl.classList.toggle("xw-typing--visible",e),e&&this.scrollToBottom())}updateConnectionStatus(e){this.statusBar&&(e==="connecting"?(this.statusBar.textContent="Connecting...",this.statusBar.classList.add("xw-status-bar--visible")):e==="error"?(this.statusBar.textContent="Connection error. Retrying...",this.statusBar.classList.add("xw-status-bar--visible")):this.statusBar.classList.remove("xw-status-bar--visible"))}scrollToBottom(){this.messagesEl&&(this.messagesEl.scrollTop=this.messagesEl.scrollHeight)}autoResizeInput(){this.inputEl&&(this.inputEl.style.height="auto",this.inputEl.style.height=Math.min(this.inputEl.scrollHeight,100)+"px")}formatTime(e){return new Date(e).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}escapeHTML(e){const t=document.createElement("div");return t.textContent=e,t.innerHTML}};function G(e){const t=new j(e);return t.mount(),t}var kt={XSpaceWidget:j,createWidget:G};window.XSpace={...window.XSpace,...kt};function xe(){const e=document.currentScript;if(!e)return;const t=e.dataset.serverUrl;t&&G({serverUrl:t,agentId:e.dataset.agentId,theme:e.dataset.theme||void 0,position:e.dataset.position||void 0,apiKey:e.dataset.token})}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",xe):xe(),y.XSpaceWidget=j,y.createWidget=G});

//# sourceMappingURL=xspace-widget.umd.js.map

