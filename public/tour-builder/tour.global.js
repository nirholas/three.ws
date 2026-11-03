"use strict";var ThreeWsTour=(()=>{var dc=Object.defineProperty;var t0=Object.getOwnPropertyDescriptor;var n0=Object.getOwnPropertyNames;var i0=Object.prototype.hasOwnProperty;var rt=(i,e,t)=>()=>{if(t)throw t[0];try{return i&&(e=i(i=0)),e}catch(n){throw t=[n],n}};var La=(i,e)=>{for(var t in e)dc(i,t,{get:e[t],enumerable:!0})},s0=(i,e,t,n)=>{if(e&&typeof e=="object"||typeof e=="function")for(let s of n0(e))!i0.call(i,s)&&s!==t&&dc(i,s,{get:()=>e[s],enumerable:!(n=t0(e,s))||n.enumerable});return i};var r0=i=>s0(dc({},"__esModule",{value:!0}),i);function c0(i){for(let e=i.length-1;e>=0;--e)if(i[e]>=65535)return!0;return!1}function Df(i){return ArrayBuffer.isView(i)&&!(i instanceof DataView)}function qs(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function Nf(){let i=qs("canvas");return i.style.display="block",i}function Ur(...i){let e="THREE."+i.shift();Xs?Xs("log",e,...i):console.log(e,...i)}function Ff(i){let e=i[0];if(typeof e=="string"&&e.startsWith("TSL:")){let t=i[1];t&&t.isStackTrace?i[0]+=" "+t.getLocation():i[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return i}function Se(...i){i=Ff(i);let e="THREE."+i.shift();if(Xs)Xs("warn",e,...i);else{let t=i[0];t&&t.isStackTrace?console.warn(t.getError(e)):console.warn(e,...i)}}function Pe(...i){i=Ff(i);let e="THREE."+i.shift();if(Xs)Xs("error",e,...i);else{let t=i[0];t&&t.isStackTrace?console.error(t.getError(e)):console.error(e,...i)}}function Qi(...i){let e=i.join(" ");e in md||(md[e]=!0,Se(...i))}function Uf(i,e,t){return new Promise(function(n,s){function r(){switch(i.clientWaitSync(e,i.SYNC_FLUSH_COMMANDS_BIT,0)){case i.WAIT_FAILED:s();break;case i.TIMEOUT_EXPIRED:setTimeout(r,t);break;default:n()}}setTimeout(r,t)})}function Qn(){let i=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Wt[i&255]+Wt[i>>8&255]+Wt[i>>16&255]+Wt[i>>24&255]+"-"+Wt[e&255]+Wt[e>>8&255]+"-"+Wt[e>>16&15|64]+Wt[e>>24&255]+"-"+Wt[t&63|128]+Wt[t>>8&255]+"-"+Wt[t>>16&255]+Wt[t>>24&255]+Wt[n&255]+Wt[n>>8&255]+Wt[n>>16&255]+Wt[n>>24&255]).toLowerCase()}function We(i,e,t){return Math.max(e,Math.min(t,i))}function wh(i,e){return(i%e+e)%e}function h0(i,e,t,n,s){return n+(i-e)*(s-n)/(t-e)}function u0(i,e,t){return i!==e?(t-i)/(e-i):0}function Dr(i,e,t){return(1-t)*i+t*e}function d0(i,e,t,n){return Dr(i,e,1-Math.exp(-t*n))}function f0(i,e=1){return e-Math.abs(wh(i,e*2)-e)}function p0(i,e,t){return i<=e?0:i>=t?1:(i=(i-e)/(t-e),i*i*(3-2*i))}function m0(i,e,t){return i<=e?0:i>=t?1:(i=(i-e)/(t-e),i*i*i*(i*(i*6-15)+10))}function g0(i,e){return i+Math.floor(Math.random()*(e-i+1))}function _0(i,e){return i+Math.random()*(e-i)}function b0(i){return i*(.5-Math.random())}function x0(i){i!==void 0&&(gd=i);let e=gd+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function y0(i){return i*kr}function v0(i){return i*ns}function w0(i){return i>0&&Number.isInteger(i)&&2**Math.round(Math.log2(i))===i}function M0(i){return Math.pow(2,Math.ceil(Math.log(i)/Math.LN2))}function Mh(i){return Math.pow(2,Math.floor(Math.log(i)/Math.LN2))}function S0(i,e,t,n,s){let r=Math.cos,a=Math.sin,o=r(t/2),l=a(t/2),c=r((e+n)/2),h=a((e+n)/2),u=r((e-n)/2),d=a((e-n)/2),f=r((n-e)/2),m=a((n-e)/2);switch(s){case"XYX":i.set(o*h,l*u,l*d,o*c);break;case"YZY":i.set(l*d,o*h,l*u,o*c);break;case"ZXZ":i.set(l*u,l*d,o*h,o*c);break;case"XZX":i.set(o*h,l*m,l*f,o*c);break;case"YXY":i.set(l*f,o*h,l*m,o*c);break;case"ZYZ":i.set(l*m,l*f,o*h,o*c);break;default:Se("MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+s)}}function wl(i){switch(i.constructor){case Uint32Array:return 4294967295;case Uint16Array:return 65535;case Uint8Array:case Uint8ClampedArray:return 255;case Int32Array:return 2147483647;case Int16Array:return 32767;case Int8Array:return 127;default:return}}function Sh(i,e){if(e.constructor===Float32Array)return i;let t=wl(e);if(t===void 0)throw new Error("THREE.MathUtils: Invalid component type.");return Math.max(i/t,-1)}function Ah(i,e){if(e.constructor===Float32Array)return i;let t=wl(e);if(t===void 0)throw new Error("THREE.MathUtils: Invalid component type.");return Math.round(i*t)}function A0(){let i={enabled:!0,workingColorSpace:Jt,spaces:{},convert:function(s,r,a){return this.enabled===!1||r===a||!r||!a||(this.spaces[r].transfer===$e&&(s.r=di(s.r),s.g=di(s.g),s.b=di(s.b)),this.spaces[r].primaries!==this.spaces[a].primaries&&(s.applyMatrix3(this.spaces[r].toXYZ),s.applyMatrix3(this.spaces[a].fromXYZ)),this.spaces[a].transfer===$e&&(s.r=zs(s.r),s.g=zs(s.g),s.b=zs(s.b))),s},workingToColorSpace:function(s,r){return this.convert(s,this.workingColorSpace,r)},colorSpaceToWorking:function(s,r){return this.convert(s,r,this.workingColorSpace)},getPrimaries:function(s){return this.spaces[s].primaries},getTransfer:function(s){return s===yi?Fr:this.spaces[s].transfer},getToneMappingMode:function(s){return this.spaces[s].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(s,r=this.workingColorSpace){return s.fromArray(this.spaces[r].luminanceCoefficients)},define:function(s){Object.assign(this.spaces,s)},_getMatrix:function(s,r,a){return s.copy(this.spaces[a].fromXYZ).multiply(this.spaces[r].toXYZ)},_getDrawingBufferColorSpace:function(s){return this.spaces[s].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(s=this.workingColorSpace){return this.spaces[s].workingColorSpaceConfig.unpackColorSpace}},e=[.64,.33,.3,.6,.15,.06],t=[.2126,.7152,.0722],n=[.3127,.329];return i.define({[Jt]:{primaries:e,whitePoint:n,transfer:Fr,toXYZ:bd,fromXYZ:xd,luminanceCoefficients:t,workingColorSpaceConfig:{unpackColorSpace:wt},outputColorSpaceConfig:{drawingBufferColorSpace:wt}},[wt]:{primaries:e,whitePoint:n,transfer:$e,toXYZ:bd,fromXYZ:xd,luminanceCoefficients:t,outputColorSpaceConfig:{drawingBufferColorSpace:wt}}}),i}function di(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function zs(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}function _c(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?mo.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(Se("Texture: Unable to serialize Texture."),{})}function yc(i,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?i+(e-i)*6*t:t<1/2?e:t<2/3?i+(e-i)*6*(2/3-t):i}function Rc(i,e,t,n,s){for(let r=0,a=i.length-3;r<=a;r+=3){Yi.fromArray(i,r);let o=s.x*Math.abs(Yi.x)+s.y*Math.abs(Yi.y)+s.z*Math.abs(Yi.z),l=e.dot(Yi),c=t.dot(Yi),h=n.dot(Yi);if(Math.max(-Math.max(l,c,h),Math.min(l,c,h))>o)return!1}return!0}function Rd(i){return i.buffer._uuid===void 0&&(i.buffer._uuid=Qn()),i.byteOffset===0&&i.byteLength===i.buffer.byteLength?i.buffer._uuid:i.buffer._uuid+":"+i.byteOffset+":"+i.byteLength}function z0(i,e,t,n,s,r,a,o){let l;if(e.side===en?l=n.intersectTriangle(a,r,s,!0,o):l=n.intersectTriangle(s,r,a,e.side===$n,o),l===null)return null;Ya.copy(o),Ya.applyMatrix4(i.matrixWorld);let c=t.ray.origin.distanceTo(Ya);return c<t.near||c>t.far?null:{distance:c,point:Ya.clone(),object:i}}function Ka(i,e,t,n,s,r,a,o,l,c){i.getVertexPosition(o,Wa),i.getVertexPosition(l,qa),i.getVertexPosition(c,Xa);let h=z0(i,e,t,n,Wa,qa,Xa,Pd);if(h){let u=new L;Li.getBarycoord(Pd,Wa,qa,Xa,u),s&&(h.uv=Li.getInterpolatedAttribute(s,o,l,c,u,new Ie)),r&&(h.uv1=Li.getInterpolatedAttribute(r,o,l,c,u,new Ie)),a&&(h.normal=Li.getInterpolatedAttribute(a,o,l,c,u,new L),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));let d={a:o,b:l,c,normal:new L,materialIndex:0};Li.getNormal(Wa,qa,Xa,d.normal),h.face=d,h.barycoord=u}return h}function eo(i,e,t,n,s,r,a){let o=i.geometry.attributes.position;if(xo.fromBufferAttribute(o,s),yo.fromBufferAttribute(o,r),t.distanceSqToSegment(xo,yo,Fc,zd)>n)return;Fc.applyMatrix4(i.matrixWorld);let c=e.ray.origin.distanceTo(Fc);if(!(c<e.near||c>e.far))return{distance:c,point:zd.clone().applyMatrix4(i.matrixWorld),index:a,face:null,faceIndex:null,barycoord:null,object:i}}function qd(i,e,t,n,s,r,a){let o=zc.distanceSqToPoint(i);if(o<t){let l=new L;zc.closestPointToPoint(i,l),l.applyMatrix4(n);let c=s.ray.origin.distanceTo(l);if(c<s.near||c>s.far)return;r.push({distance:c,distanceToRay:Math.sqrt(o),point:l,index:e,face:null,faceIndex:null,barycoord:null,object:a})}}function ms(i){let e={};for(let t in i){e[t]={};for(let n in i[t]){let s=i[t][n];if(Xd(s))s.isRenderTargetTexture?(Se("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=s.clone();else if(Array.isArray(s))if(Xd(s[0])){let r=[];for(let a=0,o=s.length;a<o;a++)r[a]=s[a].clone();e[t][n]=r}else e[t][n]=s.slice();else e[t][n]=s}}return e}function Xt(i){let e={};for(let t=0;t<i.length;t++){let n=ms(i[t]);for(let s in n)e[s]=n[s]}return e}function Xd(i){return i&&(i.isColor||i.isMatrix3||i.isMatrix4||i.isVector2||i.isVector3||i.isVector4||i.isTexture||i.isQuaternion)}function X0(i){let e=[];for(let t=0;t<i.length;t++)e.push(i[t].clone());return e}function Eh(i){let e=i.getRenderTarget();return e===null?i.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:Ge.workingColorSpace}function Nn(i,e){return!i||i.constructor===e?i:typeof e.BYTES_PER_ELEMENT=="number"?new e(i):Array.prototype.slice.call(i)}function Hs(i){return i!==void 0&&i.inTangents!==void 0&&i.outTangents!==void 0}function zf(i){function e(s,r){return i[s]-i[r]}let t=i.length,n=new Array(t);for(let s=0;s!==t;++s)n[s]=s;return n.sort(e),n}function Gc(i,e,t){let n=i.length,s=new i.constructor(n);for(let r=0,a=0;a!==n;++r){let o=t[r]*e;for(let l=0;l!==e;++l)s[a++]=i[o+l]}return s}function Gf(i,e,t,n){let s=1,r=i[0];for(;r!==void 0&&r[n]===void 0;)r=i[s++];if(r===void 0)return;let a=r[n];if(a!==void 0)if(Array.isArray(a))do a=r[n],a!==void 0&&(e.push(r.time),t.push(...a)),r=i[s++];while(r!==void 0);else if(a.toArray!==void 0)do a=r[n],a!==void 0&&(e.push(r.time),a.toArray(t,t.length)),r=i[s++];while(r!==void 0);else do a=r[n],a!==void 0&&(e.push(r.time),t.push(a)),r=i[s++];while(r!==void 0)}function K0(i,e,t,n,s=30){let r=i.clone();r.name=e;let a=[];for(let l=0;l<r.tracks.length;++l){let c=r.tracks[l],h=c.getValueSize(),u=[],d=[];for(let f=0;f<c.times.length;++f){let m=c.times[f]*s;if(!(m<t||m>=n)){u.push(c.times[f]);for(let b=0;b<h;++b)d.push(c.values[f*h+b])}}u.length!==0&&(c.times=Nn(u,c.times.constructor),c.values=Nn(d,c.values.constructor),a.push(c))}r.tracks=a;let o=1/0;for(let l=0;l<r.tracks.length;++l)o>r.tracks[l].times[0]&&(o=r.tracks[l].times[0]);for(let l=0;l<r.tracks.length;++l)r.tracks[l].shift(-1*o);return r.resetDuration(),r}function J0(i,e=0,t=i,n=30){n<=0&&(n=30);let s=t.tracks.length,r=e/n;for(let a=0;a<s;++a){let o=t.tracks[a],l=o.ValueTypeName;if(l==="bool"||l==="string")continue;let c=i.tracks.find(function(p){return p.name===o.name&&p.ValueTypeName===l});if(c===void 0)continue;let h=0,u=o.getValueSize();o.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline&&(h=u/3);let d=0,f=c.getValueSize();c.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline&&(d=f/3);let m=o.times.length-1,b;if(r<=o.times[0]){let p=h,x=u-h;b=o.values.slice(p,x)}else if(r>=o.times[m]){let p=m*u+h,x=p+u-h;b=o.values.slice(p,x)}else{let p=o.createInterpolant();p.evaluate(r),b=p.resultBuffer.slice()}l==="quaternion"&&new _e().fromArray(b).normalize().conjugate().toArray(b);let g=c.times.length;for(let p=0;p<g;++p){let x=p*f+d;if(l==="quaternion")_e.multiplyQuaternionsFlat(c.values,x,b,0,c.values,x);else{let w=f-d*2;for(let y=0;y<w;++y)c.values[x+y]-=b[y]}}}return i.blendMode=da,i}function Vf(i,e,t,n,s){let r=1-i;return r*r*r*e+3*r*r*i*t+3*r*i*i*n+i*i*i*s}function $0(i,e,t,n,s){let r=1-i;return 3*r*r*(t-e)+6*r*i*(n-t)+3*i*i*(s-n)}function Z0(i,e,t,n,s){let r=(i-e)/(s-e);for(let a=0;a<8;a++){let o=Vf(r,e,t,n,s)-i;if(Math.abs(o)<1e-10)break;let l=$0(r,e,t,n,s);if(Math.abs(l)<1e-10)break;r=Math.max(0,Math.min(1,r-o/l))}return r}function jd(i,e){for(let t=0,n=i.length;t!==n;t+=2)i[t]+=e}function Yd(i,e){for(let t=0,n=i.length;t!==n;t+=2)i[t]*=e}function Q0(i){switch(i.toLowerCase()){case"scalar":case"double":case"float":case"number":case"integer":return Un;case"vector":case"vector2":case"vector3":case"vector4":return Di;case"color":return Qr;case"quaternion":return On;case"bool":case"boolean":return gi;case"string":return _i}throw new Error("THREE.KeyframeTrack: Unsupported typeName: "+i)}function e_(i){if(i.type===void 0)throw new Error("THREE.KeyframeTrack: track type undefined, can not parse");let e=Q0(i.type);if(i.times===void 0){let n=[],s=[];Gf(i.keys,n,s,"value"),i.times=n,i.values=s}let t;return e.parse!==void 0?t=e.parse(i):t=new e(i.name,i.times,i.values,i.interpolation),Hs(i.settings)&&(t.settings={inTangents:Nn(i.settings.inTangents,Float32Array),outTangents:Nn(i.settings.outTangents,Float32Array)}),t}function Kd(i){try{let e=i.slice(i.indexOf(":")+1);return new URL(e).protocol==="blob:"}catch{return!1}}function t_(){this._document.hidden===!1&&this.reset()}function Ch(i,e,t,n){let s=u_(n);switch(t){case ph:return i*e;case Ho:return i*e/s.components*s.byteLength;case zo:return i*e/s.components*s.byteLength;case Bi:return i*e*2/s.components*s.byteLength;case Go:return i*e*2/s.components*s.byteLength;case mh:return i*e*3/s.components*s.byteLength;case En:return i*e*4/s.components*s.byteLength;case Vo:return i*e*4/s.components*s.byteLength;case aa:case oa:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case la:case ca:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case qo:case jo:return Math.max(i,16)*Math.max(e,8)/4;case Wo:case Xo:return Math.max(i,8)*Math.max(e,8)/2;case Yo:case Ko:case $o:case Zo:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case Jo:case ha:case Qo:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case el:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case tl:return Math.floor((i+4)/5)*Math.floor((e+3)/4)*16;case nl:return Math.floor((i+4)/5)*Math.floor((e+4)/5)*16;case il:return Math.floor((i+5)/6)*Math.floor((e+4)/5)*16;case sl:return Math.floor((i+5)/6)*Math.floor((e+5)/6)*16;case rl:return Math.floor((i+7)/8)*Math.floor((e+4)/5)*16;case al:return Math.floor((i+7)/8)*Math.floor((e+5)/6)*16;case ol:return Math.floor((i+7)/8)*Math.floor((e+7)/8)*16;case ll:return Math.floor((i+9)/10)*Math.floor((e+4)/5)*16;case cl:return Math.floor((i+9)/10)*Math.floor((e+5)/6)*16;case hl:return Math.floor((i+9)/10)*Math.floor((e+7)/8)*16;case ul:return Math.floor((i+9)/10)*Math.floor((e+9)/10)*16;case dl:return Math.floor((i+11)/12)*Math.floor((e+9)/10)*16;case fl:return Math.floor((i+11)/12)*Math.floor((e+11)/12)*16;case pl:case ml:case gl:return Math.ceil(i/4)*Math.ceil(e/4)*16;case _l:case bl:return Math.ceil(i/4)*Math.ceil(e/4)*8;case ua:case xl:return Math.ceil(i/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function u_(i){switch(i){case ln:case hh:return{byteLength:1,components:1};case hr:case uh:case Hn:return{byteLength:2,components:1};case Oo:case Bo:return{byteLength:2,components:4};case Bn:case Uo:case fn:return{byteLength:4,components:1};case dh:case fh:return{byteLength:4,components:3}}throw new Error(`THREE.TextureUtils: Unknown texture type ${i}.`)}var ef,Kc,tf,ra,nf,ar,$n,en,on,cs,or,Jc,$c,Zc,sf,hs,rf,af,of,lf,cf,hf,uf,df,Qc,eh,ff,pf,mf,gf,_f,bf,xf,yf,vf,oo,lo,co,Gs,ho,uo,fo,po,th,wf,Mf,Zn,nh,ih,sh,rh,ah,oh,lh,Bc,Sf,ch,us,lr,Do,No,Pi,wn,Vs,pt,Fo,ds,St,cr,An,ln,hh,uh,hr,Uo,Bn,fn,Hn,Oo,Bo,fs,dh,fh,ph,mh,En,fi,xi,Ho,zo,Bi,Go,Vo,aa,oa,la,ca,Wo,qo,Xo,jo,Yo,Ko,Jo,$o,Zo,ha,Qo,el,tl,nl,il,sl,rl,al,ol,ll,cl,hl,ul,dl,fl,pl,ml,gl,_l,bl,ua,xl,Hi,ps,Af,es,ts,ro,Hc,$i,Zi,Nr,yl,da,gh,fa,ur,Ef,vl,Tf,yi,wt,Jt,Fr,$e,ao,Rf,Cf,Lf,Pf,_h,If,kf,bh,xh,yh,vh,Mn,Ws,md,Xs,Of,Fn,Wt,gd,kr,ns,dt,Lh,Ie,_e,Ph,L,mc,_d,Ih,De,gc,bd,xd,Ge,Es,mo,E0,js,T0,bc,kt,kh,et,go,dn,Or,_o,ko,ke,Ts,Pn,R0,C0,Ai,Da,hn,yd,vd,Dt,Br,L0,wd,Rs,ai,Na,Ar,P0,I0,Md,Sd,Ad,Ed,k0,Cs,xc,nt,Pt,D0,Ys,Bf,Ei,Fa,Ee,qt,Ii,In,oi,vc,li,Ls,Ps,Td,wc,Mc,Sc,Ac,Ec,Tc,Li,bt,ci,kn,Ua,Is,ks,Ds,Ti,Ri,ji,Er,Oa,Ba,Yi,_t,Ha,N0,Ot,Hr,zr,It,F0,Tr,Cc,sn,U0,vn,Lc,Ns,un,Rr,Lt,$t,Ks,Kt,Js,Pc,O0,B0,Dn,H0,rn,hi,Ic,za,Ga,is,Sn,Cd,Ki,Va,Ld,Wa,qa,Xa,kc,ja,Pd,Ya,Bt,Cr,Id,kd,G0,Dd,Ja,Dc,Nd,Nc,ss,$s,Zs,Fd,V0,rs,pi,Fs,Ud,$a,Od,W0,Lr,Pr,Gr,Ji,q0,Za,ki,Bd,bo,Qs,xo,yo,Hd,Ir,Qa,Fc,zd,as,Gd,Vd,Vr,Wr,er,Wd,zc,to,no,qr,Xr,mi,jr,Yr,tr,Kr,Jr,Hf,j0,Y0,Xn,vo,os,Zt,wo,Mo,$r,jn,So,Zr,Ao,Eo,an,gi,Qr,Un,To,On,_i,Di,Qt,qn,Ro,Wf,Yn,ui,Vc,nr,Us,Co,ea,Ni,Fi,Uc,Jd,$d,ir,io,so,Wn,ta,Ci,Zd,Qd,Mt,Wc,na,qc,ia,Kn,Xc,Jn,Ui,bi,Oc,sa,Os,Bs,sr,Lo,Oi,Po,Th,n_,Rh,i_,s_,r_,a_,o_,l_,c_,jc,tt,Io,h_,ls,rr,Dh,Yc,Nh=rt(()=>{ef=0,Kc=1,tf=2,ra=1,nf=2,ar=3,$n=0,en=1,on=2,cs=0,or=1,Jc=2,$c=3,Zc=4,sf=5,hs=100,rf=101,af=102,of=103,lf=104,cf=200,hf=201,uf=202,df=203,Qc=204,eh=205,ff=206,pf=207,mf=208,gf=209,_f=210,bf=211,xf=212,yf=213,vf=214,oo=0,lo=1,co=2,Gs=3,ho=4,uo=5,fo=6,po=7,th=0,wf=1,Mf=2,Zn=0,nh=1,ih=2,sh=3,rh=4,ah=5,oh=6,lh=7,Bc="attached",Sf="detached",ch=300,us=301,lr=302,Do=303,No=304,Pi=1e3,wn=1001,Vs=1002,pt=1003,Fo=1004,ds=1005,St=1006,cr=1007,An=1008,ln=1009,hh=1010,uh=1011,hr=1012,Uo=1013,Bn=1014,fn=1015,Hn=1016,Oo=1017,Bo=1018,fs=1020,dh=35902,fh=35899,ph=1021,mh=1022,En=1023,fi=1026,xi=1027,Ho=1028,zo=1029,Bi=1030,Go=1031,Vo=1033,aa=33776,oa=33777,la=33778,ca=33779,Wo=35840,qo=35841,Xo=35842,jo=35843,Yo=36196,Ko=37492,Jo=37496,$o=37488,Zo=37489,ha=37490,Qo=37491,el=37808,tl=37809,nl=37810,il=37811,sl=37812,rl=37813,al=37814,ol=37815,ll=37816,cl=37817,hl=37818,ul=37819,dl=37820,fl=37821,pl=36492,ml=36494,gl=36495,_l=36283,bl=36284,ua=36285,xl=36286,Hi=2200,ps=2201,Af=2202,es=2300,ts=2301,ro=2302,Hc=2303,$i=2400,Zi=2401,Nr=2402,yl=2500,da=2501,gh=0,fa=1,ur=2,Ef=3200,vl=0,Tf=1,yi="",wt="srgb",Jt="srgb-linear",Fr="linear",$e="srgb",ao=7680,Rf=519,Cf=512,Lf=513,Pf=514,_h=515,If=516,kf=517,bh=518,xh=519,yh=35044,vh="300 es",Mn=2e3,Ws=2001;md={},Xs=null;Of={[oo]:oo,[co]:fo,[ho]:ho,[Gs]:uo,[lo]:lo,[fo]:co,[po]:po,[uo]:Gs},Fn=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){let n=this._listeners;return n===void 0?!1:n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){let n=this._listeners;if(n===void 0)return;let s=n[e];if(s!==void 0){let r=s.indexOf(t);r!==-1&&s.splice(r,1)}}dispatchEvent(e){let t=this._listeners;if(t===void 0)return;let n=t[e.type];if(n!==void 0){e.target=this;let s=n.slice(0);for(let r=0,a=s.length;r<a;r++)s[r].call(this,e);e.target=null}}},Wt=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],gd=1234567,kr=Math.PI/180,ns=180/Math.PI;dt={DEG2RAD:kr,RAD2DEG:ns,generateUUID:Qn,clamp:We,euclideanModulo:wh,mapLinear:h0,inverseLerp:u0,lerp:Dr,damp:d0,pingpong:f0,smoothstep:p0,smootherstep:m0,randInt:g0,randFloat:_0,randFloatSpread:b0,seededRandom:x0,degToRad:y0,radToDeg:v0,isPowerOfTwo:w0,ceilPowerOfTwo:M0,floorPowerOfTwo:Mh,setQuaternionFromProperEuler:S0,normalize:Ah,denormalize:Sh},Lh=class Lh{constructor(e=0,t=0){this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("THREE.Vector2: index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("THREE.Vector2: index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,n=this.y,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6],this.y=s[1]*t+s[4]*n+s[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=We(this.x,e.x,t.x),this.y=We(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=We(this.x,e,t),this.y=We(this.y,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(We(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(We(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let n=Math.cos(t),s=Math.sin(t),r=this.x-e.x,a=this.y-e.y;return this.x=r*n-a*s+e.x,this.y=r*s+a*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}};Lh.prototype.isVector2=!0;Ie=Lh,_e=class{constructor(e=0,t=0,n=0,s=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=s}static slerpFlat(e,t,n,s,r,a,o){let l=n[s+0],c=n[s+1],h=n[s+2],u=n[s+3],d=r[a+0],f=r[a+1],m=r[a+2],b=r[a+3];if(u!==b||l!==d||c!==f||h!==m){let g=l*d+c*f+h*m+u*b;g<0&&(d=-d,f=-f,m=-m,b=-b,g=-g);let p=1-o;if(g<.9995){let x=Math.acos(g),w=Math.sin(x);p=Math.sin(p*x)/w,o=Math.sin(o*x)/w,l=l*p+d*o,c=c*p+f*o,h=h*p+m*o,u=u*p+b*o}else{l=l*p+d*o,c=c*p+f*o,h=h*p+m*o,u=u*p+b*o;let x=1/Math.sqrt(l*l+c*c+h*h+u*u);l*=x,c*=x,h*=x,u*=x}}e[t]=l,e[t+1]=c,e[t+2]=h,e[t+3]=u}static multiplyQuaternionsFlat(e,t,n,s,r,a){let o=n[s],l=n[s+1],c=n[s+2],h=n[s+3],u=r[a],d=r[a+1],f=r[a+2],m=r[a+3];return e[t]=o*m+h*u+l*f-c*d,e[t+1]=l*m+h*d+c*u-o*f,e[t+2]=c*m+h*f+o*d-l*u,e[t+3]=h*m-o*u-l*d-c*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,s){return this._x=e,this._y=t,this._z=n,this._w=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,s=e._y,r=e._z,a=e._order,o=Math.cos,l=Math.sin,c=o(n/2),h=o(s/2),u=o(r/2),d=l(n/2),f=l(s/2),m=l(r/2);switch(a){case"XYZ":this._x=d*h*u+c*f*m,this._y=c*f*u-d*h*m,this._z=c*h*m+d*f*u,this._w=c*h*u-d*f*m;break;case"YXZ":this._x=d*h*u+c*f*m,this._y=c*f*u-d*h*m,this._z=c*h*m-d*f*u,this._w=c*h*u+d*f*m;break;case"ZXY":this._x=d*h*u-c*f*m,this._y=c*f*u+d*h*m,this._z=c*h*m+d*f*u,this._w=c*h*u-d*f*m;break;case"ZYX":this._x=d*h*u-c*f*m,this._y=c*f*u+d*h*m,this._z=c*h*m-d*f*u,this._w=c*h*u+d*f*m;break;case"YZX":this._x=d*h*u+c*f*m,this._y=c*f*u+d*h*m,this._z=c*h*m-d*f*u,this._w=c*h*u-d*f*m;break;case"XZY":this._x=d*h*u-c*f*m,this._y=c*f*u-d*h*m,this._z=c*h*m+d*f*u,this._w=c*h*u+d*f*m;break;default:Se("Quaternion: .setFromEuler() encountered an unknown order: "+a)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,s=Math.sin(n);return this._x=e.x*s,this._y=e.y*s,this._z=e.z*s,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],s=t[4],r=t[8],a=t[1],o=t[5],l=t[9],c=t[2],h=t[6],u=t[10],d=n+o+u;if(d>0){let f=.5/Math.sqrt(d+1);this._w=.25/f,this._x=(h-l)*f,this._y=(r-c)*f,this._z=(a-s)*f}else if(n>o&&n>u){let f=2*Math.sqrt(1+n-o-u);this._w=(h-l)/f,this._x=.25*f,this._y=(s+a)/f,this._z=(r+c)/f}else if(o>u){let f=2*Math.sqrt(1+o-n-u);this._w=(r-c)/f,this._x=(s+a)/f,this._y=.25*f,this._z=(l+h)/f}else{let f=2*Math.sqrt(1+u-n-o);this._w=(a-s)/f,this._x=(r+c)/f,this._y=(l+h)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<1e-8?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(We(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let s=Math.min(1,t/n);return this.slerp(e,s),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,s=e._y,r=e._z,a=e._w,o=t._x,l=t._y,c=t._z,h=t._w;return this._x=n*h+a*o+s*c-r*l,this._y=s*h+a*l+r*o-n*c,this._z=r*h+a*c+n*l-s*o,this._w=a*h-n*o-s*l-r*c,this._onChangeCallback(),this}slerp(e,t){let n=e._x,s=e._y,r=e._z,a=e._w,o=this.dot(e);o<0&&(n=-n,s=-s,r=-r,a=-a,o=-o);let l=1-t;if(o<.9995){let c=Math.acos(o),h=Math.sin(c);l=Math.sin(l*c)/h,t=Math.sin(t*c)/h,this._x=this._x*l+n*t,this._y=this._y*l+s*t,this._z=this._z*l+r*t,this._w=this._w*l+a*t,this._onChangeCallback()}else this._x=this._x*l+n*t,this._y=this._y*l+s*t,this._z=this._z*l+r*t,this._w=this._w*l+a*t,this.normalize();return this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),s=Math.sqrt(1-n),r=Math.sqrt(n);return this.set(s*Math.sin(e),s*Math.cos(e),r*Math.sin(t),r*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},Ph=class Ph{constructor(e=0,t=0,n=0){this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("THREE.Vector3: index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("THREE.Vector3: index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(_d.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(_d.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6]*s,this.y=r[1]*t+r[4]*n+r[7]*s,this.z=r[2]*t+r[5]*n+r[8]*s,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,s=this.z,r=e.elements,a=1/(r[3]*t+r[7]*n+r[11]*s+r[15]);return this.x=(r[0]*t+r[4]*n+r[8]*s+r[12])*a,this.y=(r[1]*t+r[5]*n+r[9]*s+r[13])*a,this.z=(r[2]*t+r[6]*n+r[10]*s+r[14])*a,this}applyQuaternion(e){let t=this.x,n=this.y,s=this.z,r=e.x,a=e.y,o=e.z,l=e.w,c=2*(a*s-o*n),h=2*(o*t-r*s),u=2*(r*n-a*t);return this.x=t+l*c+a*u-o*h,this.y=n+l*h+o*c-r*u,this.z=s+l*u+r*h-a*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[4]*n+r[8]*s,this.y=r[1]*t+r[5]*n+r[9]*s,this.z=r[2]*t+r[6]*n+r[10]*s,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=We(this.x,e.x,t.x),this.y=We(this.y,e.y,t.y),this.z=We(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=We(this.x,e,t),this.y=We(this.y,e,t),this.z=We(this.z,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(We(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,s=e.y,r=e.z,a=t.x,o=t.y,l=t.z;return this.x=s*l-r*o,this.y=r*a-n*l,this.z=n*o-s*a,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return mc.copy(this).projectOnVector(e),this.sub(mc)}reflect(e){return this.sub(mc.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(We(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,s=this.z-e.z;return t*t+n*n+s*s}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let s=Math.sin(t)*e;return this.x=s*Math.sin(n),this.y=Math.cos(t)*e,this.z=s*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),s=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=s,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}};Ph.prototype.isVector3=!0;L=Ph,mc=new L,_d=new _e,Ih=class Ih{constructor(e,t,n,s,r,a,o,l,c){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,a,o,l,c)}set(e,t,n,s,r,a,o,l,c){let h=this.elements;return h[0]=e,h[1]=s,h[2]=o,h[3]=t,h[4]=r,h[5]=l,h[6]=n,h[7]=a,h[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,s=t.elements,r=this.elements,a=n[0],o=n[3],l=n[6],c=n[1],h=n[4],u=n[7],d=n[2],f=n[5],m=n[8],b=s[0],g=s[3],p=s[6],x=s[1],w=s[4],y=s[7],S=s[2],E=s[5],_=s[8];return r[0]=a*b+o*x+l*S,r[3]=a*g+o*w+l*E,r[6]=a*p+o*y+l*_,r[1]=c*b+h*x+u*S,r[4]=c*g+h*w+u*E,r[7]=c*p+h*y+u*_,r[2]=d*b+f*x+m*S,r[5]=d*g+f*w+m*E,r[8]=d*p+f*y+m*_,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],a=e[4],o=e[5],l=e[6],c=e[7],h=e[8];return t*a*h-t*o*c-n*r*h+n*o*l+s*r*c-s*a*l}invert(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],a=e[4],o=e[5],l=e[6],c=e[7],h=e[8],u=h*a-o*c,d=o*l-h*r,f=c*r-a*l,m=t*u+n*d+s*f;if(m===0)return this.set(0,0,0,0,0,0,0,0,0);let b=1/m;return e[0]=u*b,e[1]=(s*c-h*n)*b,e[2]=(o*n-s*a)*b,e[3]=d*b,e[4]=(h*t-s*l)*b,e[5]=(s*r-o*t)*b,e[6]=f*b,e[7]=(n*l-c*t)*b,e[8]=(a*t-n*r)*b,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,s,r,a,o){let l=Math.cos(r),c=Math.sin(r);return this.set(n*l,n*c,-n*(l*a+c*o)+a+e,-s*c,s*l,-s*(-c*a+l*o)+o+t,0,0,1),this}scale(e,t){return Qi("Matrix3: .scale() is deprecated. Use .makeScale() instead."),this.premultiply(gc.makeScale(e,t)),this}rotate(e){return Qi("Matrix3: .rotate() is deprecated. Use .makeRotation() instead."),this.premultiply(gc.makeRotation(-e)),this}translate(e,t){return Qi("Matrix3: .translate() is deprecated. Use .makeTranslation() instead."),this.premultiply(gc.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let s=0;s<9;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}};Ih.prototype.isMatrix3=!0;De=Ih,gc=new De,bd=new De().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),xd=new De().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);Ge=A0();mo=class{static getDataURL(e,t="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let n;if(e instanceof HTMLCanvasElement)n=e;else{Es===void 0&&(Es=qs("canvas")),Es.width=e.width,Es.height=e.height;let s=Es.getContext("2d");e instanceof ImageData?s.putImageData(e,0,0):s.drawImage(e,0,0,e.width,e.height),n=Es}return n.toDataURL(t)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let t=qs("canvas");t.width=e.width,t.height=e.height;let n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);let s=n.getImageData(0,0,e.width,e.height),r=s.data;for(let a=0;a<r.length;a++)r[a]=di(r[a]/255)*255;return n.putImageData(s,0,0),t}else if(e.data){let t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(di(t[n]/255)*255):t[n]=di(t[n]);return{data:t,width:e.width,height:e.height}}else return Se("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},E0=0,js=class{constructor(e=null){this.isTextureSource=!0,Object.defineProperty(this,"id",{value:E0++}),this.uuid=Qn(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let t=this.data;return typeof HTMLVideoElement<"u"&&t instanceof HTMLVideoElement?e.set(t.videoWidth,t.videoHeight,0):typeof VideoFrame<"u"&&t instanceof VideoFrame?e.set(t.displayWidth,t.displayHeight,0):t!==null?e.set(t.width||0,t.height||0,t.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let n={uuid:this.uuid,url:""},s=this.data;if(s!==null){let r;if(Array.isArray(s)){r=[];for(let a=0,o=s.length;a<o;a++)s[a].isDataTexture?r.push(_c(s[a].image)):r.push(_c(s[a]))}else r=_c(s);n.url=r}return t||(e.images[this.uuid]=n),n}};T0=0,bc=new L,kt=class i extends Fn{constructor(e=i.DEFAULT_IMAGE,t=i.DEFAULT_MAPPING,n=wn,s=wn,r=St,a=An,o=En,l=ln,c=i.DEFAULT_ANISOTROPY,h=yi){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:T0++}),this.uuid=Qn(),this.name="",this.source=new js(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=s,this.magFilter=r,this.minFilter=a,this.anisotropy=c,this.format=o,this.internalFormat=null,this.type=l,this.offset=new Ie(0,0),this.repeat=new Ie(1,1),this.center=new Ie(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new De,this.generateMipmaps=!0,this.mipmapsAutoUpdate=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=h,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0,this.isPMREMTexture=!1,this.normalized=!1}get width(){return this.source.getSize(bc).x}get height(){return this.source.getSize(bc).y}get depth(){return this.source.getSize(bc).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.mipmapsAutoUpdate=e.mipmapsAutoUpdate,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isPMREMTexture=e.isPMREMTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let t in e){let n=e[t];if(n===void 0){Se(`Texture.setValues(): parameter '${t}' has value of undefined.`);continue}let s=this[t];if(s===void 0){Se(`Texture.setValues(): property '${t}' does not exist.`);continue}s&&n&&s.isVector2&&n.isVector2||s&&n&&s.isVector3&&n.isVector3||s&&n&&s.isMatrix3&&n.isMatrix3?s.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let n={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,mipmapsAutoUpdate:this.mipmapsAutoUpdate,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==ch)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case Pi:e.x=e.x-Math.floor(e.x);break;case wn:e.x=e.x<0?0:1;break;case Vs:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case Pi:e.y=e.y-Math.floor(e.y);break;case wn:e.y=e.y<0?0:1;break;case Vs:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};kt.DEFAULT_IMAGE=null;kt.DEFAULT_MAPPING=ch;kt.DEFAULT_ANISOTROPY=1;kh=class kh{constructor(e=0,t=0,n=0,s=1){this.x=e,this.y=t,this.z=n,this.w=s}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,s){return this.x=e,this.y=t,this.z=n,this.w=s,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("THREE.Vector4: index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("THREE.Vector4: index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,s=this.z,r=this.w,a=e.elements;return this.x=a[0]*t+a[4]*n+a[8]*s+a[12]*r,this.y=a[1]*t+a[5]*n+a[9]*s+a[13]*r,this.z=a[2]*t+a[6]*n+a[10]*s+a[14]*r,this.w=a[3]*t+a[7]*n+a[11]*s+a[15]*r,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,s,r,l=e.elements,c=l[0],h=l[4],u=l[8],d=l[1],f=l[5],m=l[9],b=l[2],g=l[6],p=l[10];if(Math.abs(h-d)<.01&&Math.abs(u-b)<.01&&Math.abs(m-g)<.01){if(Math.abs(h+d)<.1&&Math.abs(u+b)<.1&&Math.abs(m+g)<.1&&Math.abs(c+f+p-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;let w=(c+1)/2,y=(f+1)/2,S=(p+1)/2,E=(h+d)/4,_=(u+b)/4,A=(m+g)/4;return w>y&&w>S?w<.01?(n=0,s=.707106781,r=.707106781):(n=Math.sqrt(w),s=E/n,r=_/n):y>S?y<.01?(n=.707106781,s=0,r=.707106781):(s=Math.sqrt(y),n=E/s,r=A/s):S<.01?(n=.707106781,s=.707106781,r=0):(r=Math.sqrt(S),n=_/r,s=A/r),this.set(n,s,r,t),this}let x=Math.sqrt((g-m)*(g-m)+(u-b)*(u-b)+(d-h)*(d-h));return Math.abs(x)<.001&&(x=1),this.x=(g-m)/x,this.y=(u-b)/x,this.z=(d-h)/x,this.w=Math.acos((c+f+p-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=We(this.x,e.x,t.x),this.y=We(this.y,e.y,t.y),this.z=We(this.z,e.z,t.z),this.w=We(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=We(this.x,e,t),this.y=We(this.y,e,t),this.z=We(this.z,e,t),this.w=We(this.w,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(We(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}};kh.prototype.isVector4=!0;et=kh,go=class extends Fn{constructor(e=1,t=1,n={}){super(),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:St,depthBuffer:!0,stencilBuffer:!1,resolveColorBuffer:!0,resolveDepthBuffer:!0,resolveStencilBuffer:!0,storeMultisampledColorBuffer:!0,storeMultisampledDepthBuffer:!0,storeMultisampledStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1,useArrayDepthTexture:!1},n),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=n.depth,this.scissor=new et(0,0,e,t),this.scissorTest=!1,this.viewport=new et(0,0,e,t),this.textures=[];let s=n.count;for(let r=0;r<s;r++)this.textures[r]=new kt({width:e,height:t,depth:n.depth}),this.textures[r].isRenderTargetTexture=!0,this.textures[r].renderTarget=this;this._setTextureOptions(n),this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveColorBuffer=n.resolveColorBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this.storeMultisampledColorBuffer=n.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=n.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=n.storeMultisampledStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples,this.multiview=n.multiview,this.useArrayDepthTexture=n.useArrayDepthTexture}_setTextureOptions(e={}){let t={minFilter:St,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(t.mapping=e.mapping),e.wrapS!==void 0&&(t.wrapS=e.wrapS),e.wrapT!==void 0&&(t.wrapT=e.wrapT),e.wrapR!==void 0&&(t.wrapR=e.wrapR),e.magFilter!==void 0&&(t.magFilter=e.magFilter),e.minFilter!==void 0&&(t.minFilter=e.minFilter),e.format!==void 0&&(t.format=e.format),e.type!==void 0&&(t.type=e.type),e.anisotropy!==void 0&&(t.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(t.colorSpace=e.colorSpace),e.flipY!==void 0&&(t.flipY=e.flipY),e.generateMipmaps!==void 0&&(t.generateMipmaps=e.generateMipmaps),e.mipmapsAutoUpdate!==void 0&&(t.mipmapsAutoUpdate=e.mipmapsAutoUpdate),e.internalFormat!==void 0&&(t.internalFormat=e.internalFormat);for(let n=0;n<this.textures.length;n++)this.textures[n].setValues(t)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&this._depthTexture.renderTarget===this&&(this._depthTexture.renderTarget=null),e!==null&&e.renderTarget===null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let s=0,r=this.textures.length;s<r;s++)this.textures[s].image.width=e,this.textures[s].image.height=t,this.textures[s].image.depth=n,this.textures[s].isData3DTexture!==!0&&(this.textures[s].isArrayTexture=this.textures[s].image.depth>1);this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let t=0,n=e.textures.length;t<n;t++){this.textures[t]=e.textures[t].clone(),this.textures[t].isRenderTargetTexture=!0,this.textures[t].renderTarget=this;let s=Object.assign({},e.textures[t].image);this.textures[t].source=new js(s)}if(this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveColorBuffer=e.resolveColorBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,this.storeMultisampledColorBuffer=e.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=e.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=e.storeMultisampledStencilBuffer,e.depthTexture!==null)if(e.depthTexture.renderTarget===e){let t=e.depthTexture.clone();t.renderTarget=null,this.depthTexture=t}else this.depthTexture=e.depthTexture;else this.depthTexture=null;return this.samples=e.samples,this.multiview=e.multiview,this.useArrayDepthTexture=e.useArrayDepthTexture,this}dispose(){this.dispatchEvent({type:"dispose"})}},dn=class extends go{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}},Or=class extends kt{constructor(e=null,t=1,n=1,s=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=pt,this.minFilter=pt,this.wrapR=wn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}copy(e){return super.copy(e),this.wrapR=e.wrapR,this}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}},_o=class extends kt{constructor(e=null,t=1,n=1,s=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=pt,this.minFilter=pt,this.wrapR=wn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}copy(e){return super.copy(e),this.wrapR=e.wrapR,this}},ko=class ko{constructor(e,t,n,s,r,a,o,l,c,h,u,d,f,m,b,g){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,a,o,l,c,h,u,d,f,m,b,g)}set(e,t,n,s,r,a,o,l,c,h,u,d,f,m,b,g){let p=this.elements;return p[0]=e,p[4]=t,p[8]=n,p[12]=s,p[1]=r,p[5]=a,p[9]=o,p[13]=l,p[2]=c,p[6]=h,p[10]=u,p[14]=d,p[3]=f,p[7]=m,p[11]=b,p[15]=g,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new ko().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return this.determinantAffine()===0?(e.set(1,0,0),t.set(0,1,0),n.set(0,0,1),this):(e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this)}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){if(e.determinantAffine()===0)return this.identity();let t=this.elements,n=e.elements,s=1/Ts.setFromMatrixColumn(e,0).length(),r=1/Ts.setFromMatrixColumn(e,1).length(),a=1/Ts.setFromMatrixColumn(e,2).length();return t[0]=n[0]*s,t[1]=n[1]*s,t[2]=n[2]*s,t[3]=0,t[4]=n[4]*r,t[5]=n[5]*r,t[6]=n[6]*r,t[7]=0,t[8]=n[8]*a,t[9]=n[9]*a,t[10]=n[10]*a,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,s=e.y,r=e.z,a=Math.cos(n),o=Math.sin(n),l=Math.cos(s),c=Math.sin(s),h=Math.cos(r),u=Math.sin(r);if(e.order==="XYZ"){let d=a*h,f=a*u,m=o*h,b=o*u;t[0]=l*h,t[4]=-l*u,t[8]=c,t[1]=f+m*c,t[5]=d-b*c,t[9]=-o*l,t[2]=b-d*c,t[6]=m+f*c,t[10]=a*l}else if(e.order==="YXZ"){let d=l*h,f=l*u,m=c*h,b=c*u;t[0]=d+b*o,t[4]=m*o-f,t[8]=a*c,t[1]=a*u,t[5]=a*h,t[9]=-o,t[2]=f*o-m,t[6]=b+d*o,t[10]=a*l}else if(e.order==="ZXY"){let d=l*h,f=l*u,m=c*h,b=c*u;t[0]=d-b*o,t[4]=-a*u,t[8]=m+f*o,t[1]=f+m*o,t[5]=a*h,t[9]=b-d*o,t[2]=-a*c,t[6]=o,t[10]=a*l}else if(e.order==="ZYX"){let d=a*h,f=a*u,m=o*h,b=o*u;t[0]=l*h,t[4]=m*c-f,t[8]=d*c+b,t[1]=l*u,t[5]=b*c+d,t[9]=f*c-m,t[2]=-c,t[6]=o*l,t[10]=a*l}else if(e.order==="YZX"){let d=a*l,f=a*c,m=o*l,b=o*c;t[0]=l*h,t[4]=b-d*u,t[8]=m*u+f,t[1]=u,t[5]=a*h,t[9]=-o*h,t[2]=-c*h,t[6]=f*u+m,t[10]=d-b*u}else if(e.order==="XZY"){let d=a*l,f=a*c,m=o*l,b=o*c;t[0]=l*h,t[4]=-u,t[8]=c*h,t[1]=d*u+b,t[5]=a*h,t[9]=f*u-m,t[2]=m*u-f,t[6]=o*h,t[10]=b*u+d}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(R0,e,C0)}lookAt(e,t,n){let s=this.elements;return hn.subVectors(e,t),hn.lengthSq()===0&&(hn.z=1),hn.normalize(),Ai.crossVectors(n,hn),Ai.lengthSq()===0&&(Math.abs(n.z)===1?hn.x+=1e-4:hn.z+=1e-4,hn.normalize(),Ai.crossVectors(n,hn)),Ai.normalize(),Da.crossVectors(hn,Ai),s[0]=Ai.x,s[4]=Da.x,s[8]=hn.x,s[1]=Ai.y,s[5]=Da.y,s[9]=hn.y,s[2]=Ai.z,s[6]=Da.z,s[10]=hn.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,s=t.elements,r=this.elements,a=n[0],o=n[4],l=n[8],c=n[12],h=n[1],u=n[5],d=n[9],f=n[13],m=n[2],b=n[6],g=n[10],p=n[14],x=n[3],w=n[7],y=n[11],S=n[15],E=s[0],_=s[4],A=s[8],k=s[12],R=s[1],D=s[5],B=s[9],W=s[13],I=s[2],G=s[6],j=s[10],z=s[14],te=s[3],q=s[7],Z=s[11],Q=s[15];return r[0]=a*E+o*R+l*I+c*te,r[4]=a*_+o*D+l*G+c*q,r[8]=a*A+o*B+l*j+c*Z,r[12]=a*k+o*W+l*z+c*Q,r[1]=h*E+u*R+d*I+f*te,r[5]=h*_+u*D+d*G+f*q,r[9]=h*A+u*B+d*j+f*Z,r[13]=h*k+u*W+d*z+f*Q,r[2]=m*E+b*R+g*I+p*te,r[6]=m*_+b*D+g*G+p*q,r[10]=m*A+b*B+g*j+p*Z,r[14]=m*k+b*W+g*z+p*Q,r[3]=x*E+w*R+y*I+S*te,r[7]=x*_+w*D+y*G+S*q,r[11]=x*A+w*B+y*j+S*Z,r[15]=x*k+w*W+y*z+S*Q,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],s=e[8],r=e[12],a=e[1],o=e[5],l=e[9],c=e[13],h=e[2],u=e[6],d=e[10],f=e[14],m=e[3],b=e[7],g=e[11],p=e[15],x=l*f-c*d,w=o*f-c*u,y=o*d-l*u,S=a*f-c*h,E=a*d-l*h,_=a*u-o*h;return t*(b*x-g*w+p*y)-n*(m*x-g*S+p*E)+s*(m*w-b*S+p*_)-r*(m*y-b*E+g*_)}determinantAffine(){let e=this.elements,t=e[0],n=e[4],s=e[8],r=e[1],a=e[5],o=e[9],l=e[2],c=e[6],h=e[10];return t*(a*h-o*c)-n*(r*h-o*l)+s*(r*c-a*l)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let s=this.elements;return e.isVector3?(s[12]=e.x,s[13]=e.y,s[14]=e.z):(s[12]=e,s[13]=t,s[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],a=e[4],o=e[5],l=e[6],c=e[7],h=e[8],u=e[9],d=e[10],f=e[11],m=e[12],b=e[13],g=e[14],p=e[15],x=t*o-n*a,w=t*l-s*a,y=t*c-r*a,S=n*l-s*o,E=n*c-r*o,_=s*c-r*l,A=h*b-u*m,k=h*g-d*m,R=h*p-f*m,D=u*g-d*b,B=u*p-f*b,W=d*p-f*g,I=x*W-w*B+y*D+S*R-E*k+_*A;if(I===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let G=1/I;return e[0]=(o*W-l*B+c*D)*G,e[1]=(s*B-n*W-r*D)*G,e[2]=(b*_-g*E+p*S)*G,e[3]=(d*E-u*_-f*S)*G,e[4]=(l*R-a*W-c*k)*G,e[5]=(t*W-s*R+r*k)*G,e[6]=(g*y-m*_-p*w)*G,e[7]=(h*_-d*y+f*w)*G,e[8]=(a*B-o*R+c*A)*G,e[9]=(n*R-t*B-r*A)*G,e[10]=(m*E-b*y+p*x)*G,e[11]=(u*y-h*E-f*x)*G,e[12]=(o*k-a*D-l*A)*G,e[13]=(t*D-n*k+s*A)*G,e[14]=(b*w-m*S-g*x)*G,e[15]=(h*S-u*w+d*x)*G,this}scale(e){let t=this.elements,n=e.x,s=e.y,r=e.z;return t[0]*=n,t[4]*=s,t[8]*=r,t[1]*=n,t[5]*=s,t[9]*=r,t[2]*=n,t[6]*=s,t[10]*=r,t[3]*=n,t[7]*=s,t[11]*=r,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],s=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,s))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),s=Math.sin(t),r=1-n,a=e.x,o=e.y,l=e.z,c=r*a,h=r*o;return this.set(c*a+n,c*o-s*l,c*l+s*o,0,c*o+s*l,h*o+n,h*l-s*a,0,c*l-s*o,h*l+s*a,r*l*l+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,s,r,a){return this.set(1,n,r,0,e,1,a,0,t,s,1,0,0,0,0,1),this}compose(e,t,n){let s=this.elements,r=t._x,a=t._y,o=t._z,l=t._w,c=r+r,h=a+a,u=o+o,d=r*c,f=r*h,m=r*u,b=a*h,g=a*u,p=o*u,x=l*c,w=l*h,y=l*u,S=n.x,E=n.y,_=n.z;return s[0]=(1-(b+p))*S,s[1]=(f+y)*S,s[2]=(m-w)*S,s[3]=0,s[4]=(f-y)*E,s[5]=(1-(d+p))*E,s[6]=(g+x)*E,s[7]=0,s[8]=(m+w)*_,s[9]=(g-x)*_,s[10]=(1-(d+b))*_,s[11]=0,s[12]=e.x,s[13]=e.y,s[14]=e.z,s[15]=1,this}decompose(e,t,n){let s=this.elements;e.x=s[12],e.y=s[13],e.z=s[14];let r=this.determinantAffine();if(r===0)return n.set(1,1,1),t.identity(),this;let a=Ts.set(s[0],s[1],s[2]).length(),o=Ts.set(s[4],s[5],s[6]).length(),l=Ts.set(s[8],s[9],s[10]).length();r<0&&(a=-a),Pn.copy(this);let c=1/a,h=1/o,u=1/l;return Pn.elements[0]*=c,Pn.elements[1]*=c,Pn.elements[2]*=c,Pn.elements[4]*=h,Pn.elements[5]*=h,Pn.elements[6]*=h,Pn.elements[8]*=u,Pn.elements[9]*=u,Pn.elements[10]*=u,t.setFromRotationMatrix(Pn),n.x=a,n.y=o,n.z=l,this}makePerspective(e,t,n,s,r,a,o=Mn,l=!1){let c=this.elements,h=2*r/(t-e),u=2*r/(n-s),d=(t+e)/(t-e),f=(n+s)/(n-s),m,b;if(l)m=r/(a-r),b=a*r/(a-r);else if(o===Mn)m=-(a+r)/(a-r),b=-2*a*r/(a-r);else if(o===Ws)m=-a/(a-r),b=-a*r/(a-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return c[0]=h,c[4]=0,c[8]=d,c[12]=0,c[1]=0,c[5]=u,c[9]=f,c[13]=0,c[2]=0,c[6]=0,c[10]=m,c[14]=b,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,t,n,s,r,a,o=Mn,l=!1){let c=this.elements,h=2/(t-e),u=2/(n-s),d=-(t+e)/(t-e),f=-(n+s)/(n-s),m,b;if(l)m=1/(a-r),b=a/(a-r);else if(o===Mn)m=-2/(a-r),b=-(a+r)/(a-r);else if(o===Ws)m=-1/(a-r),b=-r/(a-r);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return c[0]=h,c[4]=0,c[8]=0,c[12]=d,c[1]=0,c[5]=u,c[9]=0,c[13]=f,c[2]=0,c[6]=0,c[10]=m,c[14]=b,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let s=0;s<16;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}};ko.prototype.isMatrix4=!0;ke=ko,Ts=new L,Pn=new ke,R0=new L(0,0,0),C0=new L(1,1,1),Ai=new L,Da=new L,hn=new L,yd=new ke,vd=new _e,Dt=class i{constructor(e=0,t=0,n=0,s=i.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=s}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,s=this._order){return this._x=e,this._y=t,this._z=n,this._order=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){let s=e.elements,r=s[0],a=s[4],o=s[8],l=s[1],c=s[5],h=s[9],u=s[2],d=s[6],f=s[10];switch(t){case"XYZ":this._y=Math.asin(We(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-h,f),this._z=Math.atan2(-a,r)):(this._x=Math.atan2(d,c),this._z=0);break;case"YXZ":this._x=Math.asin(-We(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(o,f),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-u,r),this._z=0);break;case"ZXY":this._x=Math.asin(We(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(-u,f),this._z=Math.atan2(-a,c)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-We(u,-1,1)),Math.abs(u)<.9999999?(this._x=Math.atan2(d,f),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-a,c));break;case"YZX":this._z=Math.asin(We(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-h,c),this._y=Math.atan2(-u,r)):(this._x=0,this._y=Math.atan2(o,f));break;case"XZY":this._z=Math.asin(-We(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(d,c),this._y=Math.atan2(o,r)):(this._x=Math.atan2(-h,f),this._y=0);break;default:Se("Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return yd.makeRotationFromQuaternion(e),this.setFromRotationMatrix(yd,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return vd.setFromEuler(this),this.setFromQuaternion(vd,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};Dt.DEFAULT_ORDER="XYZ";Br=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},L0=0,wd=new L,Rs=new _e,ai=new ke,Na=new L,Ar=new L,P0=new L,I0=new _e,Md=new L(1,0,0),Sd=new L(0,1,0),Ad=new L(0,0,1),Ed={type:"added"},k0={type:"removed"},Cs={type:"childadded",child:null},xc={type:"childremoved",child:null},nt=class i extends Fn{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:L0++}),this.uuid=Qn(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=i.DEFAULT_UP.clone();let e=new L,t=new Dt,n=new _e,s=new L(1,1,1);function r(){n.setFromEuler(t,!1)}function a(){t.setFromQuaternion(n,void 0,!1)}t._onChange(r),n._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:s},modelViewMatrix:{value:new ke},normalMatrix:{value:new De}}),this.matrix=new ke,this.matrixWorld=new ke,this.matrixAutoUpdate=i.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=i.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Br,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale),this.pivot!==null&&this.position.copy(this.pivot).applyMatrix4(this.matrix).sub(this.pivot)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return Rs.setFromAxisAngle(e,t),this.quaternion.multiply(Rs),this}rotateOnWorldAxis(e,t){return Rs.setFromAxisAngle(e,t),this.quaternion.premultiply(Rs),this}rotateX(e){return this.rotateOnAxis(Md,e)}rotateY(e){return this.rotateOnAxis(Sd,e)}rotateZ(e){return this.rotateOnAxis(Ad,e)}translateOnAxis(e,t){return wd.copy(e).applyQuaternion(this.quaternion),this.position.add(wd.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(Md,e)}translateY(e){return this.translateOnAxis(Sd,e)}translateZ(e){return this.translateOnAxis(Ad,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(ai.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?Na.copy(e):Na.set(e,t,n);let s=this.parent;this.updateWorldMatrix(!0,!1),Ar.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?ai.lookAt(Ar,Na,this.up):ai.lookAt(Na,Ar,this.up),this.quaternion.setFromRotationMatrix(ai),s&&(ai.extractRotation(s.matrixWorld),Rs.setFromRotationMatrix(ai),this.quaternion.premultiply(Rs.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(Pe("Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(Ed),Cs.child=e,this.dispatchEvent(Cs),Cs.child=null):Pe("Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(k0),xc.child=e,this.dispatchEvent(xc),xc.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),ai.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),ai.multiply(e.parent.matrixWorld)),e.applyMatrix4(ai),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(Ed),Cs.child=e,this.dispatchEvent(Cs),Cs.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,s=this.children.length;n<s;n++){let a=this.children[n].getObjectByProperty(e,t);if(a!==void 0)return a}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);let s=this.children;for(let r=0,a=s.length;r<a;r++)s[r].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Ar,e,P0),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Ar,I0,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}intersectsFrustum(){return!0}traverse(e){e(this);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let t=e.x,n=e.y,s=e.z,r=this.matrix.elements;r[12]+=t-r[0]*t-r[4]*n-r[8]*s,r[13]+=n-r[1]*t-r[5]*n-r[9]*s,r[14]+=s-r[2]*t-r[6]*n-r[10]*s}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t,n=!1){let s=this.parent;if(e===!0&&s!==null&&s.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||n)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,n=!0),t===!0){let r=this.children;for(let a=0,o=r.length;a<o;a++)r[a].updateWorldMatrix(!1,!0,n)}}toJSON(e){let t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let s={};s.uuid=this.uuid,s.type=this.type,s.name=this.name,s.castShadow=this.castShadow,s.receiveShadow=this.receiveShadow,s.visible=this.visible,s.frustumCulled=this.frustumCulled,s.renderOrder=this.renderOrder,s.static=this.static,s.matrixAutoUpdate=this.matrixAutoUpdate,Object.keys(this.userData).length>0&&(s.userData=this.userData),s.layers=this.layers.mask,s.matrix=this.matrix.toArray(),s.up=this.up.toArray(),this.pivot!==null&&(s.pivot=this.pivot.toArray()),this.morphTargetDictionary!==void 0&&(s.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(s.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(s.type="InstancedMesh",s.count=this.count,s.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(s.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(s.type="BatchedMesh",s.perObjectFrustumCulled=this.perObjectFrustumCulled,s.sortObjects=this.sortObjects,s.drawRanges=this._drawRanges,s.reservedRanges=this._reservedRanges,s.geometryInfo=this._geometryInfo.map(o=>({...o,boundingBox:o.boundingBox?o.boundingBox.toJSON():void 0,boundingSphere:o.boundingSphere?o.boundingSphere.toJSON():void 0})),s.instanceInfo=this._instanceInfo.map(o=>({...o})),s.availableInstanceIds=this._availableInstanceIds.slice(),s.availableGeometryIds=this._availableGeometryIds.slice(),s.nextIndexStart=this._nextIndexStart,s.nextVertexStart=this._nextVertexStart,s.geometryCount=this._geometryCount,s.maxInstanceCount=this._maxInstanceCount,s.maxVertexCount=this._maxVertexCount,s.maxIndexCount=this._maxIndexCount,s.geometryInitialized=this._geometryInitialized,s.matricesTexture=this._matricesTexture.toJSON(e),s.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(s.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(s.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(s.boundingBox=this.boundingBox.toJSON()));function r(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?s.background=this.background.toJSON():this.background.isTexture&&(s.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(s.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){s.geometry=r(e.geometries,this.geometry);let o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){let l=o.shapes;if(Array.isArray(l))for(let c=0,h=l.length;c<h;c++){let u=l[c];r(e.shapes,u)}else r(e.shapes,l)}}if(this.isSkinnedMesh&&(s.bindMode=this.bindMode,s.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(e.skeletons,this.skeleton),s.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let o=[];for(let l=0,c=this.material.length;l<c;l++)o.push(r(e.materials,this.material[l]));s.material=o}else s.material=r(e.materials,this.material);if(this.children.length>0){s.children=[];for(let o=0;o<this.children.length;o++)s.children.push(this.children[o].toJSON(e).object)}if(this.animations.length>0){s.animations=[];for(let o=0;o<this.animations.length;o++){let l=this.animations[o];s.animations.push(r(e.animations,l))}}if(t){let o=a(e.geometries),l=a(e.materials),c=a(e.textures),h=a(e.images),u=a(e.shapes),d=a(e.skeletons),f=a(e.animations),m=a(e.nodes);o.length>0&&(n.geometries=o),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),h.length>0&&(n.images=h),u.length>0&&(n.shapes=u),d.length>0&&(n.skeletons=d),f.length>0&&(n.animations=f),m.length>0&&(n.nodes=m)}return n.object=s,n;function a(o){let l=[];for(let c in o){let h=o[c];delete h.metadata,l.push(h)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot!==null?e.pivot.clone():null,this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){let s=e.children[n];this.add(s.clone())}return this}dispose(){this.dispatchEvent({type:"dispose"})}};nt.DEFAULT_UP=new L(0,1,0);nt.DEFAULT_MATRIX_AUTO_UPDATE=!0;nt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;Pt=class extends nt{constructor(){super(),this.isGroup=!0,this.type="Group"}},D0={type:"move"},Ys=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Pt,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Pt,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new L,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new L),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Pt,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new L,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new L,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let t=this._hand;if(t)for(let n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let s=null,r=null,a=null,o=this._targetRay,l=this._grip,c=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(c&&e.hand){a=!0;for(let b of e.hand.values()){let g=t.getJointPose(b,n),p=this._getHandJoint(c,b);g!==null&&(p.matrix.fromArray(g.transform.matrix),p.matrix.decompose(p.position,p.quaternion,p.scale),p.matrixWorldNeedsUpdate=!0,p.jointRadius=g.radius),p.visible=g!==null}let h=c.joints["index-finger-tip"],u=c.joints["thumb-tip"],d=h.position.distanceTo(u.position),f=.02,m=.005;c.inputState.pinching&&d>f+m?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&d<=f-m&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(r=t.getPose(e.gripSpace,n),r!==null&&(l.matrix.fromArray(r.transform.matrix),l.matrix.decompose(l.position,l.quaternion,l.scale),l.matrixWorldNeedsUpdate=!0,r.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(r.linearVelocity)):l.hasLinearVelocity=!1,r.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(r.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:e,target:this})));o!==null&&(s=t.getPose(e.targetRaySpace,n),s===null&&r!==null&&(s=r),s!==null&&(o.matrix.fromArray(s.transform.matrix),o.matrix.decompose(o.position,o.quaternion,o.scale),o.matrixWorldNeedsUpdate=!0,s.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(s.linearVelocity)):o.hasLinearVelocity=!1,s.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(s.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(D0)))}return o!==null&&(o.visible=s!==null),l!==null&&(l.visible=r!==null),c!==null&&(c.visible=a!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){let n=new Pt;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}},Bf={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Ei={h:0,s:0,l:0},Fa={h:0,s:0,l:0};Ee=class{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){let s=e;s&&s.isColor?this.copy(s):typeof s=="number"?this.setHex(s):typeof s=="string"&&this.setStyle(s)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=wt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,Ge.colorSpaceToWorking(this,t),this}setRGB(e,t,n,s=Ge.workingColorSpace){return this.r=e,this.g=t,this.b=n,Ge.colorSpaceToWorking(this,s),this}setHSL(e,t,n,s=Ge.workingColorSpace){if(e=wh(e,1),t=We(t,0,1),n=We(n,0,1),t===0)this.r=this.g=this.b=n;else{let r=n<=.5?n*(1+t):n+t-n*t,a=2*n-r;this.r=yc(a,r,e+1/3),this.g=yc(a,r,e),this.b=yc(a,r,e-1/3)}return Ge.colorSpaceToWorking(this,s),this}setStyle(e,t=wt){function n(r){r!==void 0&&parseFloat(r)<1&&Se("Color: Alpha component of "+e+" will be ignored.")}let s;if(s=/^(\w+)\(([^\)]*)\)/.exec(e)){let r,a=s[1],o=s[2];switch(a){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+(?:\.\d+)?|\.\d+)\s*)?$/.exec(o))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,t);if(r=/^\s*(\d+(?:\.\d+)?|\.\d+)\%\s*,\s*(\d+(?:\.\d+)?|\.\d+)\%\s*,\s*(\d+(?:\.\d+)?|\.\d+)\%\s*(?:,\s*(\d+(?:\.\d+)?|\.\d+)\s*)?$/.exec(o))return n(r[4]),this.setRGB(Math.min(100,parseFloat(r[1]))/100,Math.min(100,parseFloat(r[2]))/100,Math.min(100,parseFloat(r[3]))/100,t);break;case"hsl":case"hsla":if(r=/^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*(\d+(?:\.\d+)?|\.\d+)\%\s*,\s*(\d+(?:\.\d+)?|\.\d+)\%\s*(?:,\s*(\d+(?:\.\d+)?|\.\d+)\s*)?$/.exec(o))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,t);break;default:Se("Color: Unknown color model "+e)}}else if(s=/^\#([A-Fa-f\d]+)$/.exec(e)){let r=s[1],a=r.length;if(a===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,t);if(a===6)return this.setHex(parseInt(r,16),t);Se("Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=wt){let n=Bf[e.toLowerCase()];return n!==void 0?this.setHex(n,t):Se("Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=di(e.r),this.g=di(e.g),this.b=di(e.b),this}copyLinearToSRGB(e){return this.r=zs(e.r),this.g=zs(e.g),this.b=zs(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=wt){return Ge.workingToColorSpace(qt.copy(this),e),Math.round(We(qt.r*255,0,255))*65536+Math.round(We(qt.g*255,0,255))*256+Math.round(We(qt.b*255,0,255))}getHexString(e=wt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=Ge.workingColorSpace){Ge.workingToColorSpace(qt.copy(this),t);let n=qt.r,s=qt.g,r=qt.b,a=Math.max(n,s,r),o=Math.min(n,s,r),l,c,h=(o+a)/2;if(o===a)l=0,c=0;else{let u=a-o;switch(c=h<=.5?u/(a+o):u/(2-a-o),a){case n:l=(s-r)/u+(s<r?6:0);break;case s:l=(r-n)/u+2;break;case r:l=(n-s)/u+4;break}l/=6}return e.h=l,e.s=c,e.l=h,e}getRGB(e,t=Ge.workingColorSpace){return Ge.workingToColorSpace(qt.copy(this),t),e.r=qt.r,e.g=qt.g,e.b=qt.b,e}getStyle(e=wt){Ge.workingToColorSpace(qt.copy(this),e);let t=qt.r,n=qt.g,s=qt.b;return e!==wt?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${s.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(s*255)})`}offsetHSL(e,t,n){return this.getHSL(Ei),this.setHSL(Ei.h+e,Ei.s+t,Ei.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(Ei),e.getHSL(Fa);let n=Dr(Ei.h,Fa.h,t),s=Dr(Ei.s,Fa.s,t),r=Dr(Ei.l,Fa.l,t);return this.setHSL(n,s,r),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,n=this.g,s=this.b,r=e.elements;return this.r=r[0]*t+r[3]*n+r[6]*s,this.g=r[1]*t+r[4]*n+r[7]*s,this.b=r[2]*t+r[5]*n+r[8]*s,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},qt=new Ee;Ee.NAMES=Bf;Ii=class extends nt{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Dt,this.environmentIntensity=1,this.environmentRotation=new Dt,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),this.background=e.background!==null?e.background.clone():null,this.environment=e.environment!==null?e.environment.clone():null,this.fog=e.fog!==null?e.fog.clone():null,this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),this.overrideMaterial=e.overrideMaterial!==null?e.overrideMaterial.clone():null,this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),t.object.backgroundBlurriness=this.backgroundBlurriness,t.object.backgroundIntensity=this.backgroundIntensity,t.object.backgroundRotation=this.backgroundRotation.toArray(),t.object.environmentIntensity=this.environmentIntensity,t.object.environmentRotation=this.environmentRotation.toArray(),t}},In=new L,oi=new L,vc=new L,li=new L,Ls=new L,Ps=new L,Td=new L,wc=new L,Mc=new L,Sc=new L,Ac=new et,Ec=new et,Tc=new et,Li=class i{constructor(e=new L,t=new L,n=new L){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,s){s.subVectors(n,t),In.subVectors(e,t),s.cross(In);let r=s.lengthSq();return r>0?s.multiplyScalar(1/Math.sqrt(r)):s.set(0,0,0)}static getBarycoord(e,t,n,s,r){In.subVectors(s,t),oi.subVectors(n,t),vc.subVectors(e,t);let a=In.dot(In),o=In.dot(oi),l=In.dot(vc),c=oi.dot(oi),h=oi.dot(vc),u=a*c-o*o;if(u===0)return r.set(0,0,0),null;let d=1/u,f=(c*l-o*h)*d,m=(a*h-o*l)*d;return r.set(1-f-m,m,f)}static containsPoint(e,t,n,s){return this.getBarycoord(e,t,n,s,li)===null?!1:li.x>=0&&li.y>=0&&li.x+li.y<=1}static getInterpolation(e,t,n,s,r,a,o,l){return this.getBarycoord(e,t,n,s,li)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,li.x),l.addScaledVector(a,li.y),l.addScaledVector(o,li.z),l)}static getInterpolatedAttribute(e,t,n,s,r,a){return Ac.setScalar(0),Ec.setScalar(0),Tc.setScalar(0),Ac.fromBufferAttribute(e,t),Ec.fromBufferAttribute(e,n),Tc.fromBufferAttribute(e,s),a.setScalar(0),a.addScaledVector(Ac,r.x),a.addScaledVector(Ec,r.y),a.addScaledVector(Tc,r.z),a}static isFrontFacing(e,t,n,s){return In.subVectors(n,t),oi.subVectors(e,t),In.cross(oi).dot(s)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,s){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[s]),this}setFromAttributeAndIndices(e,t,n,s){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,s),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return In.subVectors(this.c,this.b),oi.subVectors(this.a,this.b),In.cross(oi).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return i.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return i.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,n,s,r){return i.getInterpolation(e,this.a,this.b,this.c,t,n,s,r)}containsPoint(e){return i.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return i.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){let n=this.a,s=this.b,r=this.c,a,o;Ls.subVectors(s,n),Ps.subVectors(r,n),wc.subVectors(e,n);let l=Ls.dot(wc),c=Ps.dot(wc);if(l<=0&&c<=0)return t.copy(n);Mc.subVectors(e,s);let h=Ls.dot(Mc),u=Ps.dot(Mc);if(h>=0&&u<=h)return t.copy(s);let d=l*u-h*c;if(d<=0&&l>=0&&h<=0&&l-h>0)return a=l/(l-h),t.copy(n).addScaledVector(Ls,a);Sc.subVectors(e,r);let f=Ls.dot(Sc),m=Ps.dot(Sc);if(m>=0&&f<=m)return t.copy(r);let b=f*c-l*m;if(b<=0&&c>=0&&m<=0)return o=c/(c-m),t.copy(n).addScaledVector(Ps,o);let g=h*m-f*u;if(g<=0&&u-h>=0&&f-m>=0)return Td.subVectors(r,s),o=(u-h)/(u-h+(f-m)),t.copy(s).addScaledVector(Td,o);let p=1/(g+b+d);return a=b*p,o=d*p,t.copy(n).addScaledVector(Ls,a).addScaledVector(Ps,o)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},bt=class{constructor(e=new L(1/0,1/0,1/0),t=new L(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(kn.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(kn.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let n=kn.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let n=e.geometry;if(n!==void 0){let r=n.getAttribute("position");if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0&&e.isBatchedMesh!==!0)for(let a=0,o=r.count;a<o;a++)e.isMesh===!0?e.getVertexPosition(a,kn):kn.fromBufferAttribute(r,a),kn.applyMatrix4(e.matrixWorld),this.expandByPoint(kn);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),Ua.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),Ua.copy(n.boundingBox)),Ua.applyMatrix4(e.matrixWorld),this.union(Ua)}let s=e.children;for(let r=0,a=s.length;r<a;r++)this.expandByObject(s[r],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,kn),kn.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(Er),Oa.subVectors(this.max,Er),Is.subVectors(e.a,Er),ks.subVectors(e.b,Er),Ds.subVectors(e.c,Er),Ti.subVectors(ks,Is),Ri.subVectors(Ds,ks),ji.subVectors(Is,Ds);let t=[0,-Ti.z,Ti.y,0,-Ri.z,Ri.y,0,-ji.z,ji.y,Ti.z,0,-Ti.x,Ri.z,0,-Ri.x,ji.z,0,-ji.x,-Ti.y,Ti.x,0,-Ri.y,Ri.x,0,-ji.y,ji.x,0];return!Rc(t,Is,ks,Ds,Oa)||(t=[1,0,0,0,1,0,0,0,1],!Rc(t,Is,ks,Ds,Oa))?!1:(Ba.crossVectors(Ti,Ri),t=[Ba.x,Ba.y,Ba.z],Rc(t,Is,ks,Ds,Oa))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,kn).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(kn).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(ci[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),ci[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),ci[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),ci[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),ci[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),ci[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),ci[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),ci[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(ci),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},ci=[new L,new L,new L,new L,new L,new L,new L,new L],kn=new L,Ua=new bt,Is=new L,ks=new L,Ds=new L,Ti=new L,Ri=new L,ji=new L,Er=new L,Oa=new L,Ba=new L,Yi=new L;_t=new L,Ha=new Ie,N0=0,Ot=class extends Fn{constructor(e,t,n=!1){if(super(),Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:N0++}),this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=yh,this.updateRanges=[],this.gpuType=fn,this.version=0,this._normalizationScale=e!==void 0?wl(e):void 0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this._normalizationScale=e._normalizationScale,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let s=0,r=this.itemSize;s<r;s++)this.array[e+s]=t.array[n+s];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)Ha.fromBufferAttribute(this,t),Ha.applyMatrix3(e),this.setXY(t,Ha.x,Ha.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)_t.fromBufferAttribute(this,t),_t.applyMatrix3(e),this.setXYZ(t,_t.x,_t.y,_t.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)_t.fromBufferAttribute(this,t),_t.applyMatrix4(e),this.setXYZ(t,_t.x,_t.y,_t.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)_t.fromBufferAttribute(this,t),_t.applyNormalMatrix(e),this.setXYZ(t,_t.x,_t.y,_t.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)_t.fromBufferAttribute(this,t),_t.transformDirection(e),this.setXYZ(t,_t.x,_t.y,_t.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=this._denormalize(n)),n}setComponent(e,t,n){return this.normalized&&(n=this._normalize(n)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=this._denormalize(t)),t}setX(e,t){return this.normalized&&(t=this._normalize(t)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=this._denormalize(t)),t}setY(e,t){return this.normalized&&(t=this._normalize(t)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=this._denormalize(t)),t}setZ(e,t){return this.normalized&&(t=this._normalize(t)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=this._denormalize(t)),t}setW(e,t){return this.normalized&&(t=this._normalize(t)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=this._normalize(t),n=this._normalize(n)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,s){return e*=this.itemSize,this.normalized&&(t=this._normalize(t),n=this._normalize(n),s=this._normalize(s)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e*=this.itemSize,this.normalized&&(t=this._normalize(t),n=this._normalize(n),s=this._normalize(s),r=this._normalize(r)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this.array[e+3]=r,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return e.name=this.name,e.usage=this.usage,e.gpuType=this.gpuType,e}dispose(){this.dispatchEvent({type:"dispose"})}_denormalize(e){let t=this._normalizationScale;return t!==void 0?Math.max(e/t,-1):Sh(e,this.array)}_normalize(e){let t=this._normalizationScale;return t!==void 0?Math.round(e*t):Ah(e,this.array)}},Hr=class extends Ot{constructor(e,t,n){super(new Uint16Array(e),t,n)}},zr=class extends Ot{constructor(e,t,n){super(new Uint32Array(e),t,n)}},It=class extends Ot{constructor(e,t,n){super(new Float32Array(e),t,n)}},F0=new bt,Tr=new L,Cc=new L,sn=class{constructor(e=new L,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let n=this.center;t!==void 0?n.copy(t):F0.setFromPoints(e).getCenter(n);let s=0;for(let r=0,a=e.length;r<a;r++)s=Math.max(s,n.distanceToSquared(e[r]));return this.radius=Math.sqrt(s),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Tr.subVectors(e,this.center);let t=Tr.lengthSq();if(t>this.radius*this.radius){let n=Math.sqrt(t),s=(n-this.radius)*.5;this.center.addScaledVector(Tr,s/n),this.radius+=s}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(Cc.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Tr.copy(e.center).add(Cc)),this.expandByPoint(Tr.copy(e.center).sub(Cc))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},U0=0,vn=new ke,Lc=new nt,Ns=new L,un=new bt,Rr=new bt,Lt=new L,$t=class i extends Fn{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:U0++}),this.uuid=Qn(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(c0(e)?zr:Hr)(e,1):this.index=e,this}setIndirect(e,t=0){return this.indirect=e,this.indirectOffset=t,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){let t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let r=new De().getNormalMatrix(e);n.applyNormalMatrix(r),n.needsUpdate=!0}let s=this.attributes.tangent;return s!==void 0&&(s.transformDirection(e),s.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this._transformed=!0,this}applyQuaternion(e){return vn.makeRotationFromQuaternion(e),this.applyMatrix4(vn),this}rotateX(e){return vn.makeRotationX(e),this.applyMatrix4(vn),this}rotateY(e){return vn.makeRotationY(e),this.applyMatrix4(vn),this}rotateZ(e){return vn.makeRotationZ(e),this.applyMatrix4(vn),this}translate(e,t,n){return vn.makeTranslation(e,t,n),this.applyMatrix4(vn),this}scale(e,t,n){return vn.makeScale(e,t,n),this.applyMatrix4(vn),this}lookAt(e){return Lc.lookAt(e),Lc.updateMatrix(),this.applyMatrix4(Lc.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Ns).negate(),this.translate(Ns.x,Ns.y,Ns.z),this}setFromPoints(e){let t=this.getAttribute("position");if(t===void 0){let n=[];for(let s=0,r=e.length;s<r;s++){let a=e[s];n.push(a.x,a.y,a.z||0)}this.setAttribute("position",new It(n,3))}else{let n=Math.min(e.length,t.count);for(let s=0;s<n;s++){let r=e[s];t.setXYZ(s,r.x,r.y,r.z||0)}e.length>t.count&&Se("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new bt);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Pe("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new L(-1/0,-1/0,-1/0),new L(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,s=t.length;n<s;n++){let r=t[n];un.setFromBufferAttribute(r),this.morphTargetsRelative?(Lt.addVectors(this.boundingBox.min,un.min),this.boundingBox.expandByPoint(Lt),Lt.addVectors(this.boundingBox.max,un.max),this.boundingBox.expandByPoint(Lt)):(this.boundingBox.expandByPoint(un.min),this.boundingBox.expandByPoint(un.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&Pe('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new sn);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Pe("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new L,1/0);return}if(e){let n=this.boundingSphere.center;if(un.setFromBufferAttribute(e),t)for(let r=0,a=t.length;r<a;r++){let o=t[r];Rr.setFromBufferAttribute(o),this.morphTargetsRelative?(Lt.addVectors(un.min,Rr.min),un.expandByPoint(Lt),Lt.addVectors(un.max,Rr.max),un.expandByPoint(Lt)):(un.expandByPoint(Rr.min),un.expandByPoint(Rr.max))}un.getCenter(n);let s=0;for(let r=0,a=e.count;r<a;r++)Lt.fromBufferAttribute(e,r),s=Math.max(s,n.distanceToSquared(Lt));if(t)for(let r=0,a=t.length;r<a;r++){let o=t[r],l=this.morphTargetsRelative;for(let c=0,h=o.count;c<h;c++)Lt.fromBufferAttribute(o,c),l&&(Ns.fromBufferAttribute(e,c),Lt.add(Ns)),s=Math.max(s,n.distanceToSquared(Lt))}this.boundingSphere.radius=Math.sqrt(s),isNaN(this.boundingSphere.radius)&&Pe('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){Pe("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let n=t.position,s=t.normal,r=t.uv,a=this.getAttribute("tangent");(a===void 0||a.count!==n.count)&&(a=new Ot(new Float32Array(4*n.count),4),this.setAttribute("tangent",a));let o=[],l=[],c=new Uint8Array(n.count);for(let k=0;k<n.count;k++)o[k]=new L,l[k]=new L;let h=new L,u=new L,d=new L,f=new Ie,m=new Ie,b=new Ie,g=new L,p=new L;function x(k,R,D){c[k]=c[R]=c[D]=1,h.fromBufferAttribute(n,k),u.fromBufferAttribute(n,R),d.fromBufferAttribute(n,D),f.fromBufferAttribute(r,k),m.fromBufferAttribute(r,R),b.fromBufferAttribute(r,D),u.sub(h),d.sub(h),m.sub(f),b.sub(f);let B=1/(m.x*b.y-b.x*m.y);isFinite(B)&&(g.copy(u).multiplyScalar(b.y).addScaledVector(d,-m.y).multiplyScalar(B),p.copy(d).multiplyScalar(m.x).addScaledVector(u,-b.x).multiplyScalar(B),o[k].add(g),o[R].add(g),o[D].add(g),l[k].add(p),l[R].add(p),l[D].add(p))}let w=this.groups;w.length===0&&(w=[{start:0,count:e.count}]);for(let k=0,R=w.length;k<R;++k){let D=w[k],B=D.start,W=D.count;for(let I=B,G=B+W;I<G;I+=3)x(e.getX(I+0),e.getX(I+1),e.getX(I+2))}let y=new L,S=new L,E=new L,_=new L;function A(k){E.fromBufferAttribute(s,k),_.copy(E);let R=o[k];y.copy(R),y.sub(E.multiplyScalar(E.dot(R))).normalize(),S.crossVectors(_,R);let B=S.dot(l[k])<0?-1:1;a.setXYZW(k,y.x,y.y,y.z,B)}for(let k=0,R=n.count;k<R;++k)c[k]&&A(k);this._transformed=!0}computeVertexNormals(){let e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0||n.count!==t.count)n=new Ot(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let d=0,f=n.count;d<f;d++)n.setXYZ(d,0,0,0);let s=new L,r=new L,a=new L,o=new L,l=new L,c=new L,h=new L,u=new L;if(e)for(let d=0,f=e.count;d<f;d+=3){let m=e.getX(d+0),b=e.getX(d+1),g=e.getX(d+2);s.fromBufferAttribute(t,m),r.fromBufferAttribute(t,b),a.fromBufferAttribute(t,g),h.subVectors(a,r),u.subVectors(s,r),h.cross(u),o.fromBufferAttribute(n,m),l.fromBufferAttribute(n,b),c.fromBufferAttribute(n,g),o.add(h),l.add(h),c.add(h),n.setXYZ(m,o.x,o.y,o.z),n.setXYZ(b,l.x,l.y,l.z),n.setXYZ(g,c.x,c.y,c.z)}else for(let d=0,f=t.count;d<f;d+=3)s.fromBufferAttribute(t,d+0),r.fromBufferAttribute(t,d+1),a.fromBufferAttribute(t,d+2),h.subVectors(a,r),u.subVectors(s,r),h.cross(u),n.setXYZ(d+0,h.x,h.y,h.z),n.setXYZ(d+1,h.x,h.y,h.z),n.setXYZ(d+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)Lt.fromBufferAttribute(e,t),Lt.normalize(),e.setXYZ(t,Lt.x,Lt.y,Lt.z)}toNonIndexed(){function e(o,l){let c=o.array,h=o.itemSize,u=o.normalized,d=new c.constructor(l.length*h),f=0,m=0;for(let b=0,g=l.length;b<g;b++){o.isInterleavedBufferAttribute?f=l[b]*o.data.stride+o.offset:f=l[b]*h;for(let p=0;p<h;p++)d[m++]=c[f++]}return new Ot(d,h,u)}if(this.index===null)return Se("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let t=new i,n=this.index.array,s=this.attributes;for(let o in s){let l=s[o],c=e(l,n);t.setAttribute(o,c)}let r=this.morphAttributes;for(let o in r){let l=[],c=r[o];for(let h=0,u=c.length;h<u;h++){let d=c[h],f=e(d,n);l.push(f)}t.morphAttributes[o]=l}t.morphTargetsRelative=this.morphTargetsRelative;let a=this.groups;for(let o=0,l=a.length;o<l;o++){let c=a[o];t.addGroup(c.start,c.count,c.materialIndex)}return t}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.parameters!==void 0&&this._transformed===!0?"BufferGeometry":this.type,e.name=this.name,Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0&&this._transformed!==!0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};let t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});let n=this.attributes;for(let l in n){let c=n[l];e.data.attributes[l]=c.toJSON(e.data)}let s={},r=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],h=[];for(let u=0,d=c.length;u<d;u++){let f=c[u];h.push(f.toJSON(e.data))}h.length>0&&(s[l]=h,r=!0)}r&&(e.data.morphAttributes=s,e.data.morphTargetsRelative=this.morphTargetsRelative);let a=this.groups;a.length>0&&(e.data.groups=JSON.parse(JSON.stringify(a)));let o=this.boundingSphere;return o!==null&&(e.data.boundingSphere=o.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let t={};this.name=e.name;let n=e.index;n!==null&&this.setIndex(n.clone());let s=e.attributes;for(let c in s){let h=s[c];this.setAttribute(c,h.clone(t))}let r=e.morphAttributes;for(let c in r){let h=[],u=r[c];for(let d=0,f=u.length;d<f;d++)h.push(u[d].clone(t));this.morphAttributes[c]=h}this.morphTargetsRelative=e.morphTargetsRelative;let a=e.groups;for(let c=0,h=a.length;c<h;c++){let u=a[c];this.addGroup(u.start,u.count,u.materialIndex)}let o=e.boundingBox;o!==null&&(this.boundingBox=o.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this._transformed=e._transformed,this}dispose(){this.dispatchEvent({type:"dispose"})}},Ks=class{constructor(e,t){this.isInterleavedBuffer=!0,this.array=e,this.stride=t,this.count=e!==void 0?e.length/t:0,this.usage=yh,this.updateRanges=[],this.version=0,this.uuid=Qn()}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.array=new e.array.constructor(e.array),this.count=e.count,this.stride=e.stride,this.usage=e.usage,this}copyAt(e,t,n){e*=this.stride,n*=t.stride;for(let s=0,r=this.stride;s<r;s++)this.array[e+s]=t.array[n+s];return this}set(e,t=0){return this.array.set(e,t),this}clone(e){e.arrayBuffers===void 0&&(e.arrayBuffers={});let t=Rd(this.array);e.arrayBuffers[t]===void 0&&(e.arrayBuffers[t]=this.array.slice(0).buffer);let n=new this.array.constructor(e.arrayBuffers[t]),s=new this.constructor(n,this.stride);return s.setUsage(this.usage),s}onUpload(e){return this.onUploadCallback=e,this}toJSON(e){e.arrayBuffers===void 0&&(e.arrayBuffers={});let t=Rd(this.array);e.arrayBuffers[t]===void 0&&(e.arrayBuffers[t]=Array.from(new Uint32Array(this.array.slice(0).buffer)));let n={uuid:this.uuid,buffer:t,type:this.array.constructor.name,stride:this.stride};return n.usage=this.usage,n}};Kt=new L,Js=class i{constructor(e,t,n,s=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=e,this.itemSize=t,this.offset=n,this.normalized=s,this._normalizationScale=e!==void 0?wl(e.array):void 0}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(e){this.data.needsUpdate=e}applyMatrix4(e){for(let t=0,n=this.data.count;t<n;t++)Kt.fromBufferAttribute(this,t),Kt.applyMatrix4(e),this.setXYZ(t,Kt.x,Kt.y,Kt.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)Kt.fromBufferAttribute(this,t),Kt.applyNormalMatrix(e),this.setXYZ(t,Kt.x,Kt.y,Kt.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)Kt.fromBufferAttribute(this,t),Kt.transformDirection(e),this.setXYZ(t,Kt.x,Kt.y,Kt.z);return this}getComponent(e,t){let n=this.array[e*this.data.stride+this.offset+t];return this.normalized&&(n=this._denormalize(n)),n}setComponent(e,t,n){return this.normalized&&(n=this._normalize(n)),this.data.array[e*this.data.stride+this.offset+t]=n,this}setX(e,t){return this.normalized&&(t=this._normalize(t)),this.data.array[e*this.data.stride+this.offset]=t,this}setY(e,t){return this.normalized&&(t=this._normalize(t)),this.data.array[e*this.data.stride+this.offset+1]=t,this}setZ(e,t){return this.normalized&&(t=this._normalize(t)),this.data.array[e*this.data.stride+this.offset+2]=t,this}setW(e,t){return this.normalized&&(t=this._normalize(t)),this.data.array[e*this.data.stride+this.offset+3]=t,this}getX(e){let t=this.data.array[e*this.data.stride+this.offset];return this.normalized&&(t=this._denormalize(t)),t}getY(e){let t=this.data.array[e*this.data.stride+this.offset+1];return this.normalized&&(t=this._denormalize(t)),t}getZ(e){let t=this.data.array[e*this.data.stride+this.offset+2];return this.normalized&&(t=this._denormalize(t)),t}getW(e){let t=this.data.array[e*this.data.stride+this.offset+3];return this.normalized&&(t=this._denormalize(t)),t}setXY(e,t,n){return e=e*this.data.stride+this.offset,this.normalized&&(t=this._normalize(t),n=this._normalize(n)),this.data.array[e+0]=t,this.data.array[e+1]=n,this}setXYZ(e,t,n,s){return e=e*this.data.stride+this.offset,this.normalized&&(t=this._normalize(t),n=this._normalize(n),s=this._normalize(s)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e=e*this.data.stride+this.offset,this.normalized&&(t=this._normalize(t),n=this._normalize(n),s=this._normalize(s),r=this._normalize(r)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=s,this.data.array[e+3]=r,this}clone(e){if(e===void 0){Ur("InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");let t=[];for(let n=0;n<this.count;n++){let s=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)t.push(this.data.array[s+r])}return new Ot(new this.array.constructor(t),this.itemSize,this.normalized)}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.clone(e)),new i(e.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(e){if(e===void 0){Ur("InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");let t=[];for(let n=0;n<this.count;n++){let s=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)t.push(this.data.array[s+r])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:t,normalized:this.normalized}}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.toJSON(e)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}_denormalize(e){let t=this._normalizationScale;return t!==void 0?Math.max(e/t,-1):Sh(e,this.data.array)}_normalize(e){let t=this._normalizationScale;return t!==void 0?Math.round(e*t):Ah(e,this.data.array)}},Pc=new L,O0=new L,B0=new De,Dn=class{constructor(e=new L(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,s){return this.normal.set(e,t,n),this.constant=s,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let s=Pc.subVectors(n,t).cross(O0.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(s,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t,n=!0){let s=e.delta(Pc),r=this.normal.dot(s);if(r===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let a=-(e.start.dot(this.normal)+this.constant)/r;return n===!0&&(a<0||a>1)?null:t.copy(e.start).addScaledVector(s,a)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||B0.getNormalMatrix(e),s=this.coplanarPoint(Pc).applyMatrix4(e),r=this.normal.applyMatrix3(n).normalize();return this.constant=-s.dot(r),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}toJSON(){return{normal:this.normal.toArray(),constant:this.constant}}fromJSON(e){return this.normal.fromArray(e.normal),this.constant=e.constant,this}},H0=0,rn=class extends Fn{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:H0++}),this.uuid=Qn(),this.name="",this.type="Material",this.blending=or,this.side=$n,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Qc,this.blendDst=eh,this.blendEquation=hs,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Ee(0,0,0),this.blendAlpha=0,this.depthFunc=Gs,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Rf,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=ao,this.stencilZFail=ao,this.stencilZPass=ao,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let n=e[t];if(n===void 0){Se(`Material: parameter '${t}' has value of undefined.`);continue}let s=this[t];if(s===void 0){Se(`Material: '${t}' is not a property of THREE.${this.type}.`);continue}s&&s.isColor?s.set(n):s&&s.isVector2&&n&&n.isVector2||s&&s.isEuler&&n&&n.isEuler||s&&s.isVector3&&n&&n.isVector3?s.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});let n={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,n.blending=this.blending,n.side=this.side,n.shadowSide=this.shadowSide,n.vertexColors=this.vertexColors,n.opacity=this.opacity,n.transparent=this.transparent,n.blendSrc=this.blendSrc,n.blendDst=this.blendDst,n.blendEquation=this.blendEquation,n.blendSrcAlpha=this.blendSrcAlpha,n.blendDstAlpha=this.blendDstAlpha,n.blendEquationAlpha=this.blendEquationAlpha,n.blendColor=this.blendColor.getHex(),n.blendAlpha=this.blendAlpha,n.depthFunc=this.depthFunc,n.depthTest=this.depthTest,n.depthWrite=this.depthWrite,n.colorWrite=this.colorWrite,n.clipIntersection=this.clipIntersection,n.clipShadows=this.clipShadows,n.stencilWriteMask=this.stencilWriteMask,n.stencilFunc=this.stencilFunc,n.stencilRef=this.stencilRef,n.stencilFuncMask=this.stencilFuncMask,n.stencilFail=this.stencilFail,n.stencilZFail=this.stencilZFail,n.stencilZPass=this.stencilZPass,n.stencilWrite=this.stencilWrite,n.polygonOffset=this.polygonOffset,n.polygonOffsetFactor=this.polygonOffsetFactor,n.polygonOffsetUnits=this.polygonOffsetUnits,n.dithering=this.dithering,n.alphaTest=this.alphaTest,n.alphaHash=this.alphaHash,n.alphaToCoverage=this.alphaToCoverage,n.premultipliedAlpha=this.premultipliedAlpha,n.forceSinglePass=this.forceSinglePass,n.allowOverride=this.allowOverride,n.visible=this.visible,n.toneMapped=this.toneMapped,n.name=this.name,this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.diffuseRoughness!==void 0&&(n.diffuseRoughness=this.diffuseRoughness),this.diffuseRoughnessMap&&this.diffuseRoughnessMap.isTexture&&(n.diffuseRoughnessMap=this.diffuseRoughnessMap.toJSON(e).uuid),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(n.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(n.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.retroreflectivity!==void 0&&(n.retroreflectivity=this.retroreflectivity),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessMinimum!==void 0&&(n.iridescenceThicknessMinimum=this.iridescenceThicknessMinimum),this.iridescenceThicknessMaximum!==void 0&&(n.iridescenceThicknessMaximum=this.iridescenceThicknessMaximum),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),Array.isArray(this.clippingPlanes)&&this.clippingPlanes.length>0&&(n.clippingPlanes=this.clippingPlanes.map(r=>r.toJSON())),this.rotation!==void 0&&(n.rotation=this.rotation),this.depthPacking!==void 0&&(n.depthPacking=this.depthPacking),this.linewidth!==void 0&&(n.linewidth=this.linewidth),this.linecap!==void 0&&(n.linecap=this.linecap),this.linejoin!==void 0&&(n.linejoin=this.linejoin),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.wireframe!==void 0&&(n.wireframe=this.wireframe),this.wireframeLinewidth!==void 0&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!==void 0&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!==void 0&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading!==void 0&&(n.flatShading=this.flatShading),this.fog!==void 0&&(n.fog=this.fog),Object.keys(this.userData).length>0&&(n.userData=this.userData);function s(r){let a=[];for(let o in r){let l=r[o];delete l.metadata,a.push(l)}return a}if(t){let r=s(e.textures),a=s(e.images);r.length>0&&(n.textures=r),a.length>0&&(n.images=a)}return n}fromJSON(e,t){if(e.uuid!==void 0&&(this.uuid=e.uuid),e.name!==void 0&&(this.name=e.name),e.color!==void 0&&this.color!==void 0&&this.color.setHex(e.color),e.roughness!==void 0&&(this.roughness=e.roughness),e.metalness!==void 0&&(this.metalness=e.metalness),e.sheen!==void 0&&(this.sheen=e.sheen),e.sheenColor!==void 0&&(this.sheenColor=new Ee().setHex(e.sheenColor)),e.sheenRoughness!==void 0&&(this.sheenRoughness=e.sheenRoughness),e.emissive!==void 0&&this.emissive!==void 0&&this.emissive.setHex(e.emissive),e.specular!==void 0&&this.specular!==void 0&&this.specular.setHex(e.specular),e.specularIntensity!==void 0&&(this.specularIntensity=e.specularIntensity),e.specularColor!==void 0&&this.specularColor!==void 0&&this.specularColor.setHex(e.specularColor),e.shininess!==void 0&&(this.shininess=e.shininess),e.clearcoat!==void 0&&(this.clearcoat=e.clearcoat),e.clearcoatRoughness!==void 0&&(this.clearcoatRoughness=e.clearcoatRoughness),e.diffuseRoughness!==void 0&&(this.diffuseRoughness=e.diffuseRoughness),e.dispersion!==void 0&&(this.dispersion=e.dispersion),e.retroreflectivity!==void 0&&(this.retroreflectivity=e.retroreflectivity),e.iridescence!==void 0&&(this.iridescence=e.iridescence),e.iridescenceIOR!==void 0&&(this.iridescenceIOR=e.iridescenceIOR),e.iridescenceThicknessMinimum!==void 0&&(this.iridescenceThicknessMinimum=e.iridescenceThicknessMinimum),e.iridescenceThicknessMaximum!==void 0&&(this.iridescenceThicknessMaximum=e.iridescenceThicknessMaximum),e.iridescenceThicknessRange!==void 0&&(this.iridescenceThicknessMinimum=e.iridescenceThicknessRange[0],this.iridescenceThicknessMaximum=e.iridescenceThicknessRange[1]),e.transmission!==void 0&&(this.transmission=e.transmission),e.thickness!==void 0&&(this.thickness=e.thickness),e.attenuationDistance!==void 0&&(this.attenuationDistance=e.attenuationDistance),e.attenuationColor!==void 0&&this.attenuationColor!==void 0&&this.attenuationColor.setHex(e.attenuationColor),e.anisotropy!==void 0&&(this.anisotropy=e.anisotropy),e.anisotropyRotation!==void 0&&(this.anisotropyRotation=e.anisotropyRotation),e.fog!==void 0&&(this.fog=e.fog),e.flatShading!==void 0&&(this.flatShading=e.flatShading),e.blending!==void 0&&(this.blending=e.blending),e.combine!==void 0&&(this.combine=e.combine),e.side!==void 0&&(this.side=e.side),e.shadowSide!==void 0&&(this.shadowSide=e.shadowSide),e.opacity!==void 0&&(this.opacity=e.opacity),e.transparent!==void 0&&(this.transparent=e.transparent),e.alphaTest!==void 0&&(this.alphaTest=e.alphaTest),e.alphaHash!==void 0&&(this.alphaHash=e.alphaHash),e.depthFunc!==void 0&&(this.depthFunc=e.depthFunc),e.depthTest!==void 0&&(this.depthTest=e.depthTest),e.depthWrite!==void 0&&(this.depthWrite=e.depthWrite),e.colorWrite!==void 0&&(this.colorWrite=e.colorWrite),e.clippingPlanes!==void 0&&(this.clippingPlanes=e.clippingPlanes.map(n=>new Dn().fromJSON(n))),e.clipIntersection!==void 0&&(this.clipIntersection=e.clipIntersection),e.clipShadows!==void 0&&(this.clipShadows=e.clipShadows),e.depthPacking!==void 0&&(this.depthPacking=e.depthPacking),e.blendSrc!==void 0&&(this.blendSrc=e.blendSrc),e.blendDst!==void 0&&(this.blendDst=e.blendDst),e.blendEquation!==void 0&&(this.blendEquation=e.blendEquation),e.blendSrcAlpha!==void 0&&(this.blendSrcAlpha=e.blendSrcAlpha),e.blendDstAlpha!==void 0&&(this.blendDstAlpha=e.blendDstAlpha),e.blendEquationAlpha!==void 0&&(this.blendEquationAlpha=e.blendEquationAlpha),e.blendColor!==void 0&&this.blendColor!==void 0&&this.blendColor.setHex(e.blendColor),e.blendAlpha!==void 0&&(this.blendAlpha=e.blendAlpha),e.stencilWriteMask!==void 0&&(this.stencilWriteMask=e.stencilWriteMask),e.stencilFunc!==void 0&&(this.stencilFunc=e.stencilFunc),e.stencilRef!==void 0&&(this.stencilRef=e.stencilRef),e.stencilFuncMask!==void 0&&(this.stencilFuncMask=e.stencilFuncMask),e.stencilFail!==void 0&&(this.stencilFail=e.stencilFail),e.stencilZFail!==void 0&&(this.stencilZFail=e.stencilZFail),e.stencilZPass!==void 0&&(this.stencilZPass=e.stencilZPass),e.stencilWrite!==void 0&&(this.stencilWrite=e.stencilWrite),e.wireframe!==void 0&&(this.wireframe=e.wireframe),e.wireframeLinewidth!==void 0&&(this.wireframeLinewidth=e.wireframeLinewidth),e.wireframeLinecap!==void 0&&(this.wireframeLinecap=e.wireframeLinecap),e.wireframeLinejoin!==void 0&&(this.wireframeLinejoin=e.wireframeLinejoin),e.rotation!==void 0&&(this.rotation=e.rotation),e.linewidth!==void 0&&(this.linewidth=e.linewidth),e.linecap!==void 0&&(this.linecap=e.linecap),e.linejoin!==void 0&&(this.linejoin=e.linejoin),e.dashSize!==void 0&&(this.dashSize=e.dashSize),e.gapSize!==void 0&&(this.gapSize=e.gapSize),e.scale!==void 0&&(this.scale=e.scale),e.polygonOffset!==void 0&&(this.polygonOffset=e.polygonOffset),e.polygonOffsetFactor!==void 0&&(this.polygonOffsetFactor=e.polygonOffsetFactor),e.polygonOffsetUnits!==void 0&&(this.polygonOffsetUnits=e.polygonOffsetUnits),e.dithering!==void 0&&(this.dithering=e.dithering),e.alphaToCoverage!==void 0&&(this.alphaToCoverage=e.alphaToCoverage),e.premultipliedAlpha!==void 0&&(this.premultipliedAlpha=e.premultipliedAlpha),e.forceSinglePass!==void 0&&(this.forceSinglePass=e.forceSinglePass),e.allowOverride!==void 0&&(this.allowOverride=e.allowOverride),e.visible!==void 0&&(this.visible=e.visible),e.toneMapped!==void 0&&(this.toneMapped=e.toneMapped),e.userData!==void 0&&(this.userData=e.userData),e.vertexColors!==void 0&&(typeof e.vertexColors=="number"?this.vertexColors=e.vertexColors>0:this.vertexColors=e.vertexColors),e.size!==void 0&&(this.size=e.size),e.sizeAttenuation!==void 0&&(this.sizeAttenuation=e.sizeAttenuation),e.map!==void 0&&(this.map=t[e.map]||null),e.matcap!==void 0&&(this.matcap=t[e.matcap]||null),e.alphaMap!==void 0&&(this.alphaMap=t[e.alphaMap]||null),e.bumpMap!==void 0&&(this.bumpMap=t[e.bumpMap]||null),e.bumpScale!==void 0&&(this.bumpScale=e.bumpScale),e.normalMap!==void 0&&(this.normalMap=t[e.normalMap]||null),e.normalMapType!==void 0&&(this.normalMapType=e.normalMapType),e.normalScale!==void 0){let n=e.normalScale;Array.isArray(n)===!1&&(n=[n,n]),this.normalScale=new Ie().fromArray(n)}return e.displacementMap!==void 0&&(this.displacementMap=t[e.displacementMap]||null),e.displacementScale!==void 0&&(this.displacementScale=e.displacementScale),e.displacementBias!==void 0&&(this.displacementBias=e.displacementBias),e.roughnessMap!==void 0&&(this.roughnessMap=t[e.roughnessMap]||null),e.metalnessMap!==void 0&&(this.metalnessMap=t[e.metalnessMap]||null),e.emissiveMap!==void 0&&(this.emissiveMap=t[e.emissiveMap]||null),e.emissiveIntensity!==void 0&&(this.emissiveIntensity=e.emissiveIntensity),e.specularMap!==void 0&&(this.specularMap=t[e.specularMap]||null),e.specularIntensityMap!==void 0&&(this.specularIntensityMap=t[e.specularIntensityMap]||null),e.specularColorMap!==void 0&&(this.specularColorMap=t[e.specularColorMap]||null),e.envMap!==void 0&&(this.envMap=t[e.envMap]||null),e.envMapRotation!==void 0&&this.envMapRotation.fromArray(e.envMapRotation),e.envMapIntensity!==void 0&&(this.envMapIntensity=e.envMapIntensity),e.reflectivity!==void 0&&(this.reflectivity=e.reflectivity),e.refractionRatio!==void 0&&(this.refractionRatio=e.refractionRatio),e.lightMap!==void 0&&(this.lightMap=t[e.lightMap]||null),e.lightMapIntensity!==void 0&&(this.lightMapIntensity=e.lightMapIntensity),e.aoMap!==void 0&&(this.aoMap=t[e.aoMap]||null),e.aoMapIntensity!==void 0&&(this.aoMapIntensity=e.aoMapIntensity),e.gradientMap!==void 0&&(this.gradientMap=t[e.gradientMap]||null),e.clearcoatMap!==void 0&&(this.clearcoatMap=t[e.clearcoatMap]||null),e.clearcoatRoughnessMap!==void 0&&(this.clearcoatRoughnessMap=t[e.clearcoatRoughnessMap]||null),e.clearcoatNormalMap!==void 0&&(this.clearcoatNormalMap=t[e.clearcoatNormalMap]||null),e.clearcoatNormalScale!==void 0&&(this.clearcoatNormalScale=new Ie().fromArray(e.clearcoatNormalScale)),e.diffuseRoughnessMap!==void 0&&(this.diffuseRoughnessMap=t[e.diffuseRoughnessMap]||null),e.iridescenceMap!==void 0&&(this.iridescenceMap=t[e.iridescenceMap]||null),e.iridescenceThicknessMap!==void 0&&(this.iridescenceThicknessMap=t[e.iridescenceThicknessMap]||null),e.transmissionMap!==void 0&&(this.transmissionMap=t[e.transmissionMap]||null),e.thicknessMap!==void 0&&(this.thicknessMap=t[e.thicknessMap]||null),e.anisotropyMap!==void 0&&(this.anisotropyMap=t[e.anisotropyMap]||null),e.sheenColorMap!==void 0&&(this.sheenColorMap=t[e.sheenColorMap]||null),e.sheenRoughnessMap!==void 0&&(this.sheenRoughnessMap=t[e.sheenRoughnessMap]||null),this}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,n=null;if(t!==null){let s=t.length;n=new Array(s);for(let r=0;r!==s;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}},hi=new L,Ic=new L,za=new L,Ga=new L,is=class{constructor(e=new L,t=new L(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,hi)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=hi.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(hi.copy(this.origin).addScaledVector(this.direction,t),hi.distanceToSquared(e))}distanceSqToSegment(e,t,n,s){Ic.copy(e).add(t).multiplyScalar(.5),za.copy(t).sub(e).normalize(),Ga.copy(this.origin).sub(Ic);let r=e.distanceTo(t)*.5,a=-this.direction.dot(za),o=Ga.dot(this.direction),l=-Ga.dot(za),c=Ga.lengthSq(),h=Math.abs(1-a*a),u,d,f,m;if(h>0)if(u=a*l-o,d=a*o-l,m=r*h,u>=0)if(d>=-m)if(d<=m){let b=1/h;u*=b,d*=b,f=u*(u+a*d+2*o)+d*(a*u+d+2*l)+c}else d=r,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*l)+c;else d=-r,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*l)+c;else d<=-m?(u=Math.max(0,-(-a*r+o)),d=u>0?-r:Math.min(Math.max(-r,-l),r),f=-u*u+d*(d+2*l)+c):d<=m?(u=0,d=Math.min(Math.max(-r,-l),r),f=d*(d+2*l)+c):(u=Math.max(0,-(a*r+o)),d=u>0?r:Math.min(Math.max(-r,-l),r),f=-u*u+d*(d+2*l)+c);else d=a>0?-r:r,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,u),s&&s.copy(Ic).addScaledVector(za,d),f}intersectSphere(e,t){if(e.radius<0)return null;hi.subVectors(e.center,this.origin);let n=hi.dot(this.direction),s=hi.dot(hi)-n*n,r=e.radius*e.radius;if(s>r)return null;let a=Math.sqrt(r-s),o=n-a,l=n+a;return l<0?null:o<0?this.at(l,t):this.at(o,t)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){let n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,s,r,a,o,l,c=1/this.direction.x,h=1/this.direction.y,u=1/this.direction.z,d=this.origin;return c>=0?(n=(e.min.x-d.x)*c,s=(e.max.x-d.x)*c):(n=(e.max.x-d.x)*c,s=(e.min.x-d.x)*c),h>=0?(r=(e.min.y-d.y)*h,a=(e.max.y-d.y)*h):(r=(e.max.y-d.y)*h,a=(e.min.y-d.y)*h),n>a||r>s||((r>n||isNaN(n))&&(n=r),(a<s||isNaN(s))&&(s=a),u>=0?(o=(e.min.z-d.z)*u,l=(e.max.z-d.z)*u):(o=(e.max.z-d.z)*u,l=(e.min.z-d.z)*u),n>l||o>s)||((o>n||n!==n)&&(n=o),(l<s||s!==s)&&(s=l),s<0)?null:this.at(n>=0?n:s,t)}intersectsBox(e){return this.intersectBox(e,hi)!==null}intersectTriangle(e,t,n,s,r){let a=this.origin,o=this.direction,l=o.x,c=o.y,h=o.z,u=e.x-a.x,d=e.y-a.y,f=e.z-a.z,m=t.x-a.x,b=t.y-a.y,g=t.z-a.z,p=n.x-a.x,x=n.y-a.y,w=n.z-a.z,y=Math.abs(l),S=Math.abs(c),E=Math.abs(h),_,A,k,R,D,B,W,I,G,j,z,te;if(y>=S&&y>=E?(k=l,B=u,G=m,te=p,l>=0?(_=c,A=h,R=d,D=f,W=b,I=g,j=x,z=w):(_=h,A=c,R=f,D=d,W=g,I=b,j=w,z=x)):S>=E?(k=c,B=d,G=b,te=x,c>=0?(_=h,A=l,R=f,D=u,W=g,I=m,j=w,z=p):(_=l,A=h,R=u,D=f,W=m,I=g,j=p,z=w)):(k=h,B=f,G=g,te=w,h>=0?(_=l,A=c,R=u,D=d,W=m,I=b,j=p,z=x):(_=c,A=l,R=d,D=u,W=b,I=m,j=x,z=p)),k===0)return null;let q=_/k,Z=A/k,Q=1/k,we=R-q*B,Fe=D-Z*B,K=W-q*G,pe=I-Z*G,xe=j-q*te,Re=z-Z*te,me=xe*pe-Re*K,Oe=we*Re-Fe*xe,mt=K*Fe-pe*we;if(s){if(me<0||Oe<0||mt<0)return null}else if((me<0||Oe<0||mt<0)&&(me>0||Oe>0||mt>0))return null;let Le=me+Oe+mt;if(Le===0)return null;let Ze=Q*(me*B+Oe*G+mt*te);return(Le>0?Ze<0:Ze>0)?null:this.at(Ze/Le,r)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},Sn=class extends rn{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Ee(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Dt,this.combine=th,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},Cd=new ke,Ki=new is,Va=new sn,Ld=new L,Wa=new L,qa=new L,Xa=new L,kc=new L,ja=new L,Pd=new L,Ya=new L,Bt=class extends nt{constructor(e=new $t,t=new Sn){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0?this.morphTargetInfluences=e.morphTargetInfluences.slice():this.morphTargetInfluences=void 0,e.morphTargetDictionary!==void 0?this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary):this.morphTargetDictionary=void 0,this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=s.length;r<a;r++){let o=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}getVertexPosition(e,t){let n=this.geometry,s=n.attributes.position,r=n.morphAttributes.position,a=n.morphTargetsRelative;t.fromBufferAttribute(s,e);let o=this.morphTargetInfluences;if(r&&o){ja.set(0,0,0);for(let l=0,c=r.length;l<c;l++){let h=o[l],u=r[l];h!==0&&(kc.fromBufferAttribute(u,e),a?ja.addScaledVector(kc,h):ja.addScaledVector(kc.sub(t),h))}t.add(ja)}return t}intersectsFrustum(e){return e.intersectsObject(this)}raycast(e,t){let n=this.geometry,s=this.material,r=this.matrixWorld;s!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),Va.copy(n.boundingSphere),Va.applyMatrix4(r),Ki.copy(e.ray).recast(e.near),!(Va.containsPoint(Ki.origin)===!1&&(Ki.intersectSphere(Va,Ld)===null||Ki.origin.distanceToSquared(Ld)>(e.far-e.near)**2))&&(Cd.copy(r).invert(),Ki.copy(e.ray).applyMatrix4(Cd),!(n.boundingBox!==null&&Ki.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,Ki)))}_computeIntersections(e,t,n){let s,r=this.geometry,a=this.material,o=r.index,l=r.attributes.position,c=r.attributes.uv,h=r.attributes.uv1,u=r.attributes.normal,d=r.groups,f=r.drawRange;if(o!==null)if(Array.isArray(a))for(let m=0,b=d.length;m<b;m++){let g=d[m],p=a[g.materialIndex],x=Math.max(g.start,f.start),w=Math.min(o.count,Math.min(g.start+g.count,f.start+f.count));for(let y=x,S=w;y<S;y+=3){let E=o.getX(y),_=o.getX(y+1),A=o.getX(y+2);s=Ka(this,p,e,n,c,h,u,E,_,A),s&&(s.faceIndex=Math.floor(y/3),s.face.materialIndex=g.materialIndex,t.push(s))}}else{let m=Math.max(0,f.start),b=Math.min(o.count,f.start+f.count);for(let g=m,p=b;g<p;g+=3){let x=o.getX(g),w=o.getX(g+1),y=o.getX(g+2);s=Ka(this,a,e,n,c,h,u,x,w,y),s&&(s.faceIndex=Math.floor(g/3),t.push(s))}}else if(l!==void 0)if(Array.isArray(a))for(let m=0,b=d.length;m<b;m++){let g=d[m],p=a[g.materialIndex],x=Math.max(g.start,f.start),w=Math.min(l.count,Math.min(g.start+g.count,f.start+f.count));for(let y=x,S=w;y<S;y+=3){let E=y,_=y+1,A=y+2;s=Ka(this,p,e,n,c,h,u,E,_,A),s&&(s.faceIndex=Math.floor(y/3),s.face.materialIndex=g.materialIndex,t.push(s))}}else{let m=Math.max(0,f.start),b=Math.min(l.count,f.start+f.count);for(let g=m,p=b;g<p;g+=3){let x=g,w=g+1,y=g+2;s=Ka(this,a,e,n,c,h,u,x,w,y),s&&(s.faceIndex=Math.floor(g/3),t.push(s))}}}};Cr=new et,Id=new et,kd=new et,G0=new et,Dd=new ke,Ja=new L,Dc=new sn,Nd=new ke,Nc=new is,ss=class extends Bt{constructor(e,t){super(e,t),this.isSkinnedMesh=!0,this.type="SkinnedMesh",this.bindMode=Bc,this.bindMatrix=new ke,this.bindMatrixInverse=new ke,this.boundingBox=null,this.boundingSphere=null}computeBoundingBox(){let e=this.geometry;this.boundingBox===null&&(this.boundingBox=new bt),this.boundingBox.makeEmpty();let t=e.getAttribute("position");for(let n=0;n<t.count;n++)this.getVertexPosition(n,Ja),this.boundingBox.expandByPoint(Ja)}computeBoundingSphere(){let e=this.geometry;this.boundingSphere===null&&(this.boundingSphere=new sn),this.boundingSphere.makeEmpty();let t=e.getAttribute("position");for(let n=0;n<t.count;n++)this.getVertexPosition(n,Ja),this.boundingSphere.expandByPoint(Ja)}copy(e,t){return super.copy(e,t),this.bindMode=e.bindMode,this.bindMatrix.copy(e.bindMatrix),this.bindMatrixInverse.copy(e.bindMatrixInverse),this.skeleton=e.skeleton,this.boundingBox=e.boundingBox!==null?e.boundingBox.clone():null,this.boundingSphere=e.boundingSphere!==null?e.boundingSphere.clone():null,this}raycast(e,t){let n=this.material,s=this.matrixWorld;n!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),Dc.copy(this.boundingSphere),Dc.applyMatrix4(s),e.ray.intersectsSphere(Dc)!==!1&&(Nd.copy(s).invert(),Nc.copy(e.ray).applyMatrix4(Nd),!(this.boundingBox!==null&&Nc.intersectsBox(this.boundingBox)===!1)&&this._computeIntersections(e,t,Nc)))}getVertexPosition(e,t){return super.getVertexPosition(e,t),this.applyBoneTransform(e,t),t}bind(e,t){this.skeleton=e,t===void 0&&(this.updateMatrixWorld(!0),this.skeleton.calculateInverses(),t=this.matrixWorld),this.bindMatrix.copy(t),this.bindMatrixInverse.copy(t).invert()}pose(){this.skeleton.pose()}normalizeSkinWeights(){let e=new et,t=this.geometry.attributes.skinWeight;for(let n=0,s=t.count;n<s;n++){e.fromBufferAttribute(t,n);let r=1/e.manhattanLength();r!==1/0?e.multiplyScalar(r):e.set(1,0,0,0),t.setXYZW(n,e.x,e.y,e.z,e.w)}}updateMatrixWorld(e){super.updateMatrixWorld(e),this.bindMode===Bc?this.bindMatrixInverse.copy(this.matrixWorld).invert():this.bindMode===Sf?this.bindMatrixInverse.copy(this.bindMatrix).invert():Se("SkinnedMesh: Unrecognized bindMode: "+this.bindMode)}applyBoneTransform(e,t){let n=this.skeleton,s=this.geometry;Id.fromBufferAttribute(s.attributes.skinIndex,e),kd.fromBufferAttribute(s.attributes.skinWeight,e),t.isVector4?(Cr.copy(t),t.set(0,0,0,0)):(Cr.set(t.x,t.y,t.z,1),t.set(0,0,0)),Cr.applyMatrix4(this.bindMatrix);for(let r=0;r<4;r++){let a=kd.getComponent(r);if(a!==0){let o=Id.getComponent(r);Dd.multiplyMatrices(n.bones[o].matrixWorld,n.boneInverses[o]),t.addScaledVector(G0.copy(Cr).applyMatrix4(Dd),a)}}return t.isVector4&&(t.w=Cr.w),t.applyMatrix4(this.bindMatrixInverse)}},$s=class extends nt{constructor(){super(),this.isBone=!0,this.type="Bone"}},Zs=class extends kt{constructor(e=null,t=1,n=1,s,r,a,o,l,c=pt,h=pt,u,d){super(null,a,o,l,c,h,s,r,u,d),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}},Fd=new ke,V0=new ke,rs=class i{constructor(e=[],t=[]){this.uuid=Qn(),this.bones=e.slice(0),this.boneInverses=t,this.boneMatrices=null,this.previousBoneMatrices=null,this.boneTexture=null,this.previousBoneTexture=null,this.init()}init(){let e=this.bones,t=this.boneInverses;if(this.boneMatrices=new Float32Array(e.length*16),t.length===0)this.calculateInverses();else if(e.length!==t.length){Se("Skeleton: Number of inverse bone matrices does not match amount of bones."),this.boneInverses=[];for(let n=0,s=this.bones.length;n<s;n++)this.boneInverses.push(new ke)}}calculateInverses(){this.boneInverses.length=0;for(let e=0,t=this.bones.length;e<t;e++){let n=new ke;this.bones[e]&&n.copy(this.bones[e].matrixWorld).invert(),this.boneInverses.push(n)}}pose(){for(let e=0,t=this.bones.length;e<t;e++){let n=this.bones[e];n&&n.matrixWorld.copy(this.boneInverses[e]).invert()}for(let e=0,t=this.bones.length;e<t;e++){let n=this.bones[e];n&&(n.parent&&n.parent.isBone?(n.matrix.copy(n.parent.matrixWorld).invert(),n.matrix.multiply(n.matrixWorld)):n.matrix.copy(n.matrixWorld),n.matrix.decompose(n.position,n.quaternion,n.scale))}}update(){let e=this.bones,t=this.boneInverses,n=this.boneMatrices,s=this.boneTexture;for(let r=0,a=e.length;r<a;r++){let o=e[r]?e[r].matrixWorld:V0;Fd.multiplyMatrices(o,t[r]),Fd.toArray(n,r*16)}s!==null&&(s.needsUpdate=!0)}clone(){return new i(this.bones,this.boneInverses)}computeBoneTexture(){let e=Math.sqrt(this.bones.length*4);e=Math.ceil(e/4)*4,e=Math.max(e,4);let t=new Float32Array(e*e*4);t.set(this.boneMatrices);let n=new Zs(t,e,e,En,fn);return n.needsUpdate=!0,this.boneMatrices=t,this.boneTexture=n,this}getBoneByName(e){for(let t=0,n=this.bones.length;t<n;t++){let s=this.bones[t];if(s.name===e)return s}}dispose(){this.boneTexture!==null&&(this.boneTexture.dispose(),this.boneTexture=null),this.previousBoneTexture!==null&&(this.previousBoneTexture.dispose(),this.previousBoneTexture=null)}fromJSON(e,t){this.uuid=e.uuid;for(let n=0,s=e.bones.length;n<s;n++){let r=e.bones[n],a=t[r];a===void 0&&(Se("Skeleton: No bone found with UUID:",r),a=new $s),this.bones.push(a),this.boneInverses.push(new ke().fromArray(e.boneInverses[n]))}return this.init(),this}toJSON(){let e={metadata:{version:4.7,type:"Skeleton",generator:"Skeleton.toJSON"},bones:[],boneInverses:[]};e.uuid=this.uuid;let t=this.bones,n=this.boneInverses;for(let s=0,r=t.length;s<r;s++){let a=t[s];e.bones.push(a.uuid);let o=n[s];e.boneInverses.push(o.toArray())}return e}},pi=class extends Ot{constructor(e,t,n,s=1){super(e,t,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=s}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){let e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}},Fs=new ke,Ud=new ke,$a=[],Od=new bt,W0=new ke,Lr=new Bt,Pr=new sn,Gr=class extends Bt{constructor(e,t,n){super(e,t),this.isInstancedMesh=!0,this.instanceMatrix=new pi(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let s=0;s<n;s++)this.setMatrixAt(s,W0)}computeBoundingBox(){let e=this.geometry,t=this.count;this.boundingBox===null&&(this.boundingBox=new bt),e.boundingBox===null&&e.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Fs),Od.copy(e.boundingBox).applyMatrix4(Fs),this.boundingBox.union(Od)}computeBoundingSphere(){let e=this.geometry,t=this.count;this.boundingSphere===null&&(this.boundingSphere=new sn),e.boundingSphere===null&&e.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Fs),Pr.copy(e.boundingSphere).applyMatrix4(Fs),this.boundingSphere.union(Pr)}copy(e,t){return super.copy(e,t),this.instanceMatrix.copy(e.instanceMatrix),this.morphTexture=e.morphTexture!==null?e.morphTexture.clone():null,this.instanceColor=e.instanceColor!==null?e.instanceColor.clone():null,this.count=e.count,this.boundingBox=e.boundingBox!==null?e.boundingBox.clone():null,this.boundingSphere=e.boundingSphere!==null?e.boundingSphere.clone():null,this}getColorAt(e,t){return this.instanceColor===null?t.setRGB(1,1,1):t.fromArray(this.instanceColor.array,e*3)}getMatrixAt(e,t){return t.fromArray(this.instanceMatrix.array,e*16)}getMorphAt(e,t){let n=t.morphTargetInfluences,s=this.morphTexture.source.data.data,r=n.length+1,a=e*r+1;for(let o=0;o<n.length;o++)n[o]=s[a+o]}raycast(e,t){let n=this.matrixWorld,s=this.count;if(Lr.geometry=this.geometry,Lr.material=this.material,Lr.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),Pr.copy(this.boundingSphere),Pr.applyMatrix4(n),e.ray.intersectsSphere(Pr)!==!1))for(let r=0;r<s;r++){this.getMatrixAt(r,Fs),Ud.multiplyMatrices(n,Fs),Lr.matrixWorld=Ud,Lr.raycast(e,$a);for(let a=0,o=$a.length;a<o;a++){let l=$a[a];l.instanceId=r,l.object=this,t.push(l)}$a.length=0}}setColorAt(e,t){return this.instanceColor===null&&(this.instanceColor=new pi(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),t.toArray(this.instanceColor.array,e*3),this}setMatrixAt(e,t){return t.toArray(this.instanceMatrix.array,e*16),this}setMorphAt(e,t){let n=t.morphTargetInfluences,s=n.length+1;this.morphTexture===null&&(this.morphTexture=new Zs(new Float32Array(s*this.count),s,this.count,Ho,fn));let r=this.morphTexture.source.data.data,a=0;for(let c=0;c<n.length;c++)a+=n[c];let o=this.geometry.morphTargetsRelative?1:1-a,l=s*e;return r[l]=o,r.set(n,l+1),this}updateMorphTargets(){}dispose(){super.dispose(),this.instanceMatrix.dispose(),this.instanceColor!==null&&this.instanceColor.dispose(),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}},Ji=new sn,q0=new Ie(.5,.5),Za=new L,ki=class{constructor(e=new Dn,t=new Dn,n=new Dn,s=new Dn,r=new Dn,a=new Dn){this.planes=[e,t,n,s,r,a]}set(e,t,n,s,r,a){let o=this.planes;return o[0].copy(e),o[1].copy(t),o[2].copy(n),o[3].copy(s),o[4].copy(r),o[5].copy(a),this}copy(e){let t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=Mn,n=!1){let s=this.planes,r=e.elements,a=r[0],o=r[1],l=r[2],c=r[3],h=r[4],u=r[5],d=r[6],f=r[7],m=r[8],b=r[9],g=r[10],p=r[11],x=r[12],w=r[13],y=r[14],S=r[15];if(s[0].setComponents(c-a,f-h,p-m,S-x).normalize(),s[1].setComponents(c+a,f+h,p+m,S+x).normalize(),s[2].setComponents(c+o,f+u,p+b,S+w).normalize(),s[3].setComponents(c-o,f-u,p-b,S-w).normalize(),n)s[4].setComponents(l,d,g,y).normalize(),s[5].setComponents(c-l,f-d,p-g,S-y).normalize();else if(s[4].setComponents(c-l,f-d,p-g,S-y).normalize(),t===Mn)s[5].setComponents(c+l,f+d,p+g,S+y).normalize();else if(t===Ws)s[5].setComponents(l,d,g,y).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),Ji.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),Ji.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(Ji)}intersectsSprite(e){Ji.center.set(0,0,0);let t=q0.distanceTo(e.center);return Ji.radius=.7071067811865476+t,Ji.applyMatrix4(e.matrixWorld),this.intersectsSphere(Ji)}intersectsSphere(e){let t=this.planes,n=e.center,s=-e.radius;for(let r=0;r<6;r++)if(t[r].distanceToPoint(n)<s)return!1;return!0}intersectsBox(e){let t=this.planes;for(let n=0;n<6;n++){let s=t[n];if(Za.x=s.normal.x>0?e.max.x:e.min.x,Za.y=s.normal.y>0?e.max.y:e.min.y,Za.z=s.normal.z>0?e.max.z:e.min.z,s.distanceToPoint(Za)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}},Bd=new ke,bo=class i{constructor(){this.coordinateSystem=Mn,this._frustums=[],this._count=0}setFromArrayCamera(e){let t=e.cameras,n=this._frustums;for(let s=0;s<t.length;s++){let r=t[s];Bd.multiplyMatrices(r.projectionMatrix,r.matrixWorldInverse),n[s]===void 0&&(n[s]=new ki),n[s].setFromProjectionMatrix(Bd,r.coordinateSystem,r.reversedDepth)}return this._count=t.length,this}getFrustum(e){return this._frustums[e]}intersectsObject(e){let t=this._frustums;for(let n=0;n<this._count;n++)if(t[n].intersectsObject(e))return!0;return!1}intersectsSprite(e){let t=this._frustums;for(let n=0;n<this._count;n++)if(t[n].intersectsSprite(e))return!0;return!1}intersectsSphere(e){let t=this._frustums;for(let n=0;n<this._count;n++)if(t[n].intersectsSphere(e))return!0;return!1}intersectsBox(e){let t=this._frustums;for(let n=0;n<this._count;n++)if(t[n].intersectsBox(e))return!0;return!1}containsPoint(e){let t=this._frustums;for(let n=0;n<this._count;n++)if(t[n].containsPoint(e))return!0;return!1}copy(e){this.coordinateSystem=e.coordinateSystem;let t=this._frustums,n=e._frustums;for(let s=0;s<e._count;s++)t[s]===void 0&&(t[s]=new ki),t[s].copy(n[s]);return this._count=e._count,this}clone(){return new i().copy(this)}},Qs=class extends rn{constructor(e){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new Ee(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}},xo=new L,yo=new L,Hd=new ke,Ir=new is,Qa=new sn,Fc=new L,zd=new L,as=class extends nt{constructor(e=new $t,t=new Qs){super(),this.isLine=!0,this.type="Line",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0?this.morphTargetInfluences=e.morphTargetInfluences.slice():this.morphTargetInfluences=void 0,e.morphTargetDictionary!==void 0?this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary):this.morphTargetDictionary=void 0,this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[0];for(let s=1,r=t.count;s<r;s++)xo.fromBufferAttribute(t,s-1),yo.fromBufferAttribute(t,s),n[s]=n[s-1],n[s]+=xo.distanceTo(yo);e.setAttribute("lineDistance",new It(n,1))}else Se("Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}intersectsFrustum(e){return e.intersectsObject(this)}raycast(e,t){let n=this.geometry,s=this.matrixWorld,r=e.params.Line.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Qa.copy(n.boundingSphere),Qa.applyMatrix4(s),Qa.radius+=r,e.ray.intersectsSphere(Qa)===!1)return;Hd.copy(s).invert(),Ir.copy(e.ray).applyMatrix4(Hd);let o=r/((this.scale.x+this.scale.y+this.scale.z)/3),l=o*o,c=this.isLineSegments?2:1,h=n.index,d=n.attributes.position;if(h!==null){let f=Math.max(0,a.start),m=Math.min(h.count,a.start+a.count);for(let b=f,g=m-1;b<g;b+=c){let p=h.getX(b),x=h.getX(b+1),w=eo(this,e,Ir,l,p,x,b);w&&t.push(w)}if(this.isLineLoop){let b=h.getX(m-1),g=h.getX(f),p=eo(this,e,Ir,l,b,g,m-1);p&&t.push(p)}}else{let f=Math.max(0,a.start),m=Math.min(d.count,a.start+a.count);for(let b=f,g=m-1;b<g;b+=c){let p=eo(this,e,Ir,l,b,b+1,b);p&&t.push(p)}if(this.isLineLoop){let b=eo(this,e,Ir,l,m-1,f,m-1);b&&t.push(b)}}}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=s.length;r<a;r++){let o=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}};Gd=new L,Vd=new L,Vr=class extends as{constructor(e,t){super(e,t),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[];for(let s=0,r=t.count;s<r;s+=2)Gd.fromBufferAttribute(t,s),Vd.fromBufferAttribute(t,s+1),n[s]=s===0?0:n[s-1],n[s+1]=n[s]+Gd.distanceTo(Vd);e.setAttribute("lineDistance",new It(n,1))}else Se("LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}},Wr=class extends as{constructor(e,t){super(e,t),this.isLineLoop=!0,this.type="LineLoop"}},er=class extends rn{constructor(e){super(),this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new Ee(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.size=e.size,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}},Wd=new ke,zc=new is,to=new sn,no=new L,qr=class extends nt{constructor(e=new $t,t=new er){super(),this.isPoints=!0,this.type="Points",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0?this.morphTargetInfluences=e.morphTargetInfluences.slice():this.morphTargetInfluences=void 0,e.morphTargetDictionary!==void 0?this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary):this.morphTargetDictionary=void 0,this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}intersectsFrustum(e){return e.intersectsObject(this)}raycast(e,t){let n=this.geometry,s=this.matrixWorld,r=e.params.Points.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),to.copy(n.boundingSphere),to.applyMatrix4(s),to.radius+=r,e.ray.intersectsSphere(to)===!1)return;Wd.copy(s).invert(),zc.copy(e.ray).applyMatrix4(Wd);let o=r/((this.scale.x+this.scale.y+this.scale.z)/3),l=o*o,c=n.index,u=n.attributes.position;if(c!==null){let d=Math.max(0,a.start),f=Math.min(c.count,a.start+a.count);for(let m=d,b=f;m<b;m++){let g=c.getX(m);no.fromBufferAttribute(u,g),qd(no,g,l,s,e,t,this)}}else{let d=Math.max(0,a.start),f=Math.min(u.count,a.start+a.count);for(let m=d,b=f;m<b;m++)no.fromBufferAttribute(u,m),qd(no,m,l,s,e,t,this)}}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=s.length;r<a;r++){let o=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}};Xr=class extends kt{constructor(e=[],t=us,n,s,r,a,o,l,c,h){super(e,t,n,s,r,a,o,l,c,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},mi=class extends kt{constructor(e,t,n=Bn,s,r,a,o=pt,l=pt,c,h=fi,u=1){if(h!==fi&&h!==xi)throw new Error("THREE.DepthTexture: format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let d={width:e,height:t,depth:u};super(d,s,r,a,o,l,h,n,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new js(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let t=super.toJSON(e);return t.compareFunction=this.compareFunction,t}},jr=class extends mi{constructor(e,t=Bn,n=us,s,r,a=pt,o=pt,l,c=fi){let h={width:e,height:e,depth:1},u=[h,h,h,h,h,h];super(e,e,t,n,s,r,a,o,l,c),this.image=u,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(e){this.image=e}},Yr=class extends kt{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},tr=class i extends $t{constructor(e=1,t=1,n=1,s=1,r=1,a=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:s,heightSegments:r,depthSegments:a};let o=this;s=Math.floor(s),r=Math.floor(r),a=Math.floor(a);let l=[],c=[],h=[],u=[],d=0,f=0;m("z","y","x",-1,-1,n,t,e,a,r,0),m("z","y","x",1,-1,n,t,-e,a,r,1),m("x","z","y",1,1,e,n,t,s,a,2),m("x","z","y",1,-1,e,n,-t,s,a,3),m("x","y","z",1,-1,e,t,n,s,r,4),m("x","y","z",-1,-1,e,t,-n,s,r,5),this.setIndex(l),this.setAttribute("position",new It(c,3)),this.setAttribute("normal",new It(h,3)),this.setAttribute("uv",new It(u,2));function m(b,g,p,x,w,y,S,E,_,A,k){let R=y/_,D=S/A,B=y/2,W=S/2,I=E/2,G=_+1,j=A+1,z=0,te=0,q=new L;for(let Z=0;Z<j;Z++){let Q=Z*D-W;for(let we=0;we<G;we++){let Fe=we*R-B;q[b]=Fe*x,q[g]=Q*w,q[p]=I,c.push(q.x,q.y,q.z),q[b]=0,q[g]=0,q[p]=E>0?1:-1,h.push(q.x,q.y,q.z),u.push(we/_),u.push(1-Z/A),z+=1}}for(let Z=0;Z<A;Z++)for(let Q=0;Q<_;Q++){let we=d+Q+G*Z,Fe=d+Q+G*(Z+1),K=d+(Q+1)+G*(Z+1),pe=d+(Q+1)+G*Z;l.push(we,Fe,pe),l.push(Fe,K,pe),te+=6}o.addGroup(f,te,k),f+=te,d+=z}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}},Kr=class i extends $t{constructor(e=1,t=32,n=0,s=Math.PI*2){super(),this.type="CircleGeometry",this.parameters={radius:e,segments:t,thetaStart:n,thetaLength:s},t=Math.max(3,t);let r=[],a=[],o=[],l=[],c=new L,h=new Ie;a.push(0,0,0),o.push(0,0,1),l.push(.5,.5);for(let u=0,d=3;u<=t;u++,d+=3){let f=n+u/t*s;c.x=e*Math.cos(f),c.y=e*Math.sin(f),a.push(c.x,c.y,c.z),o.push(0,0,1),h.x=(a[d]/e+1)/2,h.y=(a[d+1]/e+1)/2,l.push(h.x,h.y)}for(let u=1;u<=t;u++)r.push(u,u+1,0);this.setIndex(r),this.setAttribute("position",new It(a,3)),this.setAttribute("normal",new It(o,3)),this.setAttribute("uv",new It(l,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.segments,e.thetaStart,e.thetaLength)}},Jr=class i extends $t{constructor(e=1,t=1,n=1,s=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:s};let r=e/2,a=t/2,o=Math.floor(n),l=Math.floor(s),c=o+1,h=l+1,u=e/o,d=t/l,f=[],m=[],b=[],g=[];for(let p=0;p<h;p++){let x=p*d-a;for(let w=0;w<c;w++){let y=w*u-r;m.push(y,-x,0),b.push(0,0,1),g.push(w/o),g.push(1-p/l)}}for(let p=0;p<l;p++)for(let x=0;x<o;x++){let w=x+c*p,y=x+c*(p+1),S=x+1+c*(p+1),E=x+1+c*p;f.push(w,y,E),f.push(y,S,E)}this.setIndex(f),this.setAttribute("position",new It(m,3)),this.setAttribute("normal",new It(b,3)),this.setAttribute("uv",new It(g,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.widthSegments,e.heightSegments)}};Hf={clone:ms,merge:Xt},j0=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,Y0=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,Xn=class extends rn{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=j0,this.fragmentShader=Y0,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=ms(e.uniforms),this.uniformsGroups=X0(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this.defaultAttributeValues=Object.assign({},e.defaultAttributeValues),this.index0AttributeName=e.index0AttributeName,this.uniformsNeedUpdate=e.uniformsNeedUpdate,this}toJSON(e){let t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(let s in this.uniforms){let a=this.uniforms[s].value;a&&a.isTexture?t.uniforms[s]={type:"t",value:a.toJSON(e).uuid}:a&&a.isColor?t.uniforms[s]={type:"c",value:a.getHex()}:a&&a.isVector2?t.uniforms[s]={type:"v2",value:a.toArray()}:a&&a.isVector3?t.uniforms[s]={type:"v3",value:a.toArray()}:a&&a.isVector4?t.uniforms[s]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?t.uniforms[s]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?t.uniforms[s]={type:"m4",value:a.toArray()}:t.uniforms[s]={value:a}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;let n={};for(let s in this.extensions)this.extensions[s]===!0&&(n[s]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}fromJSON(e,t){if(super.fromJSON(e,t),e.uniforms!==void 0)for(let n in e.uniforms){let s=e.uniforms[n];switch(this.uniforms[n]={},s.type){case"t":this.uniforms[n].value=t[s.value]||null;break;case"c":this.uniforms[n].value=new Ee().setHex(s.value);break;case"v2":this.uniforms[n].value=new Ie().fromArray(s.value);break;case"v3":this.uniforms[n].value=new L().fromArray(s.value);break;case"v4":this.uniforms[n].value=new et().fromArray(s.value);break;case"m3":this.uniforms[n].value=new De().fromArray(s.value);break;case"m4":this.uniforms[n].value=new ke().fromArray(s.value);break;default:this.uniforms[n].value=s.value}}if(e.defines!==void 0&&(this.defines=e.defines),e.vertexShader!==void 0&&(this.vertexShader=e.vertexShader),e.fragmentShader!==void 0&&(this.fragmentShader=e.fragmentShader),e.glslVersion!==void 0&&(this.glslVersion=e.glslVersion),e.extensions!==void 0)for(let n in e.extensions)this.extensions[n]=e.extensions[n];return e.lights!==void 0&&(this.lights=e.lights),e.clipping!==void 0&&(this.clipping=e.clipping),this}},vo=class extends Xn{constructor(e){super(e),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}},os=class extends rn{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new Ee(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Ee(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=vl,this.normalScale=new Ie(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Dt,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},Zt=class extends os{constructor(e){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:"",PHYSICAL:""},this.type="MeshPhysicalMaterial",this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new Ie(1,1),this.clearcoatNormalMap=null,this.diffuseRoughnessMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return We(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(t){this.ior=(1+.4*t)/(1-.4*t)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessMinimum=100,this.iridescenceThicknessMaximum=400,this.iridescenceThicknessMap=null,this.sheenColor=new Ee(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new Ee(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new Ee(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._diffuseRoughness=0,this._dispersion=0,this._iridescence=0,this._retroreflectivity=0,this._sheen=0,this._transmission=0,this.setValues(e)}get anisotropy(){return this._anisotropy}set anisotropy(e){this._anisotropy>0!=e>0&&this.version++,this._anisotropy=e}get clearcoat(){return this._clearcoat}set clearcoat(e){this._clearcoat>0!=e>0&&this.version++,this._clearcoat=e}get diffuseRoughness(){return this._diffuseRoughness}set diffuseRoughness(e){this._diffuseRoughness>0!=e>0&&this.version++,this._diffuseRoughness=e}get iridescence(){return this._iridescence}set iridescence(e){this._iridescence>0!=e>0&&this.version++,this._iridescence=e}get dispersion(){return this._dispersion}set dispersion(e){this._dispersion>0!=e>0&&this.version++,this._dispersion=e}get retroreflectivity(){return this._retroreflectivity}set retroreflectivity(e){this._retroreflectivity>0!=e>0&&this.version++,this._retroreflectivity=e}get sheen(){return this._sheen}set sheen(e){this._sheen>0!=e>0&&this.version++,this._sheen=e}get transmission(){return this._transmission}set transmission(e){this._transmission>0!=e>0&&this.version++,this._transmission=e}get iridescenceThicknessRange(){return Qi('MeshPhysicalMaterial: The "iridescenceThicknessRange" property has been replaced by "iridescenceThicknessMinimum" and "iridescenceThicknessMaximum".'),[this.iridescenceThicknessMinimum,this.iridescenceThicknessMaximum]}set iridescenceThicknessRange(e){Qi('MeshPhysicalMaterial: The "iridescenceThicknessRange" property has been replaced by "iridescenceThicknessMinimum" and "iridescenceThicknessMaximum".'),this.iridescenceThicknessMinimum=e[0],this.iridescenceThicknessMaximum=e[1]}copy(e){return super.copy(e),this.defines={STANDARD:"",PHYSICAL:""},this.anisotropy=e.anisotropy,this.anisotropyRotation=e.anisotropyRotation,this.anisotropyMap=e.anisotropyMap,this.clearcoat=e.clearcoat,this.clearcoatMap=e.clearcoatMap,this.clearcoatRoughness=e.clearcoatRoughness,this.clearcoatRoughnessMap=e.clearcoatRoughnessMap,this.clearcoatNormalMap=e.clearcoatNormalMap,this.clearcoatNormalScale.copy(e.clearcoatNormalScale),this.diffuseRoughness=e.diffuseRoughness,this.diffuseRoughnessMap=e.diffuseRoughnessMap,this.dispersion=e.dispersion,this.ior=e.ior,this.iridescence=e.iridescence,this.iridescenceMap=e.iridescenceMap,this.iridescenceIOR=e.iridescenceIOR,this.iridescenceThicknessMinimum=e.iridescenceThicknessMinimum,this.iridescenceThicknessMaximum=e.iridescenceThicknessMaximum,this.iridescenceThicknessMap=e.iridescenceThicknessMap,this.retroreflectivity=e.retroreflectivity,this.sheen=e.sheen,this.sheenColor.copy(e.sheenColor),this.sheenColorMap=e.sheenColorMap,this.sheenRoughness=e.sheenRoughness,this.sheenRoughnessMap=e.sheenRoughnessMap,this.transmission=e.transmission,this.transmissionMap=e.transmissionMap,this.thickness=e.thickness,this.thicknessMap=e.thicknessMap,this.attenuationDistance=e.attenuationDistance,this.attenuationColor.copy(e.attenuationColor),this.specularIntensity=e.specularIntensity,this.specularIntensityMap=e.specularIntensityMap,this.specularColor.copy(e.specularColor),this.specularColorMap=e.specularColorMap,this}},wo=class extends rn{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=Ef,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},Mo=class extends rn{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};$r=class{static convertArray(e,t){return Nn(e,t)}static isTypedArray(e){return Df(e)}static hasTangents(e){return Hs(e)}static getKeyframeOrder(e){return zf(e)}static sortedArray(e,t,n){return Gc(e,t,n)}static flattenJSON(e,t,n,s){Gf(e,t,n,s)}static subclip(e,t,n,s,r=30){return K0(e,t,n,s,r)}static makeClipAdditive(e,t=0,n=e,s=30){return J0(e,t,n,s)}},jn=class{constructor(e,t,n,s){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=s!==void 0?s:new t.constructor(n),this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,n=this._cachedIndex,s=t[n],r=t[n-1];e:{t:{let a;n:{i:if(!(e<s)){for(let o=n+2;;){if(s===void 0){if(e<r)break i;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===o)break;if(r=s,s=t[++n],e<s)break t}a=t.length;break n}if(!(e>=r)){let o=t[1];e<o&&(n=2,r=o);for(let l=n-2;;){if(r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===l)break;if(s=r,r=t[--n-1],e>=r)break t}a=n,n=0;break n}break e}for(;n<a;){let o=n+a>>>1;e<t[o]?a=o:n=o+1}if(s=t[n],r=t[n-1],r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(s===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,r,s)}return this.interpolate_(n,r,e,s)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,s=this.valueSize,r=e*s;for(let a=0;a!==s;++a)t[a]=n[r+a];return t}interpolate_(){throw new Error("THREE.Interpolant: Call to abstract method.")}intervalChanged_(){}},So=class extends jn{constructor(e,t,n,s){super(e,t,n,s),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:$i,endingEnd:$i}}intervalChanged_(e,t,n){let s=this.parameterPositions,r=e-2,a=e+1,o=s[r],l=s[a];if(o===void 0)switch(this.getSettings_().endingStart){case Zi:r=e,o=2*t-n;break;case Nr:r=s.length-2,o=t+s[r]-s[r+1];break;default:r=e,o=n}if(l===void 0)switch(this.getSettings_().endingEnd){case Zi:a=e,l=2*n-t;break;case Nr:a=1,l=n+s[1]-s[0];break;default:a=e-1,l=t}let c=(n-t)*.5,h=this.valueSize;this._weightPrev=c/(t-o),this._weightNext=c/(l-n),this._offsetPrev=r*h,this._offsetNext=a*h}interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=e*o,c=l-o,h=this._offsetPrev,u=this._offsetNext,d=this._weightPrev,f=this._weightNext,m=(n-t)/(s-t),b=m*m,g=b*m,p=-d*g+2*d*b-d*m,x=(1+d)*g+(-1.5-2*d)*b+(-.5+d)*m+1,w=(-1-f)*g+(1.5+f)*b+.5*m,y=f*g-f*b;for(let S=0;S!==o;++S)r[S]=p*a[h+S]+x*a[c+S]+w*a[l+S]+y*a[u+S];return r}},Zr=class extends jn{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=e*o,c=l-o,h=(n-t)/(s-t),u=1-h;for(let d=0;d!==o;++d)r[d]=a[c+d]*u+a[l+d]*h;return r}},Ao=class extends jn{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e){return this.copySampleValue_(e-1)}},Eo=class extends jn{interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=e*o,c=l-o,h=this.inTangents,u=this.outTangents;if(!h||!u){let m=(n-t)/(s-t),b=1-m;for(let g=0;g!==o;++g)r[g]=a[c+g]*b+a[l+g]*m;return r}let d=o*2,f=e-1;for(let m=0;m!==o;++m){let b=a[c+m],g=a[l+m],p=f*d+m*2,x=u[p],w=u[p+1],y=e*d+m*2,S=h[y],E=h[y+1],_=Z0(n,t,x,S,s);r[m]=Vf(_,b,w,E,g)}return r}};an=class{constructor(e,t,n,s){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=Nn(t,this.TimeBufferType),this.values=Nn(n,this.ValueBufferType),this.setInterpolation(s||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:Nn(e.times,Array),values:Nn(e.values,Array)};let s=e.getInterpolation();s!==e.DefaultInterpolation&&(n.interpolation=s),Hs(e.settings)&&(n.settings={inTangents:Nn(e.settings.inTangents,Array),outTangents:Nn(e.settings.outTangents,Array)})}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new Ao(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new Zr(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new So(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let t=new Eo(this.times,this.values,this.getValueSize(),e);return this.settings&&(t.inTangents=this.settings.inTangents,t.outTangents=this.settings.outTangents),t}setInterpolation(e){let t;switch(e){case es:t=this.InterpolantFactoryMethodDiscrete;break;case ts:t=this.InterpolantFactoryMethodLinear;break;case ro:t=this.InterpolantFactoryMethodSmooth;break;case Hc:t=this.InterpolantFactoryMethodBezier;break}if(t===void 0){let n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return Se("KeyframeTrack:",n),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return es;case this.InterpolantFactoryMethodLinear:return ts;case this.InterpolantFactoryMethodSmooth:return ro;case this.InterpolantFactoryMethodBezier:return Hc}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let n=0,s=t.length;n!==s;++n)t[n]+=e;Hs(this.settings)&&(jd(this.settings.inTangents,e),jd(this.settings.outTangents,e))}return this}scale(e){if(e!==1){let t=this.times;for(let n=0,s=t.length;n!==s;++n)t[n]*=e;Hs(this.settings)&&(Yd(this.settings.inTangents,e),Yd(this.settings.outTangents,e))}return this}trim(e,t){let n=this.times,s=n.length,r=0,a=s-1;for(;r!==s&&n[r]<e;)++r;for(;a!==-1&&n[a]>t;)--a;if(++a,r!==0||a!==s){r>=a&&(a=Math.max(a,1),r=a-1);let o=this.getValueSize();this.times=n.slice(r,a),this.values=this.values.slice(r*o,a*o)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(Pe("KeyframeTrack: Invalid value size in track.",this),e=!1);let n=this.times,s=this.values,r=n.length;r===0&&(Pe("KeyframeTrack: Track is empty.",this),e=!1);let a=null;for(let o=0;o!==r;o++){let l=n[o];if(typeof l=="number"&&isNaN(l)){Pe("KeyframeTrack: Time is not a valid number.",this,o,l),e=!1;break}if(a!==null&&a>l){Pe("KeyframeTrack: Out of order keys.",this,o,l,a),e=!1;break}a=l}if(s!==void 0&&Df(s))for(let o=0,l=s.length;o!==l;++o){let c=s[o];if(isNaN(c)){Pe("KeyframeTrack: Value is not a valid number.",this,o,c),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),s=this.getInterpolation()===ro,r=e.length-1,a=1;for(let o=1;o<r;++o){let l=!1,c=e[o],h=e[o+1];if(c!==h&&(o!==1||c!==e[0]))if(s)l=!0;else{let u=o*n,d=u-n,f=u+n;for(let m=0;m!==n;++m){let b=t[u+m];if(b!==t[d+m]||b!==t[f+m]){l=!0;break}}}if(l){if(o!==a){e[a]=e[o];let u=o*n,d=a*n;for(let f=0;f!==n;++f)t[d+f]=t[u+f]}++a}}if(r>0){e[a]=e[r];for(let o=r*n,l=a*n,c=0;c!==n;++c)t[l+c]=t[o+c];++a}return a!==e.length?(this.times=e.slice(0,a),this.values=t.slice(0,a*n)):(this.times=e,this.values=t),this}clone(){let e=this.times.slice(),t=this.values.slice(),n=this.constructor,s=new n(this.name,e,t);return s.createInterpolant=this.createInterpolant,Hs(this.settings)&&(s.settings={inTangents:this.settings.inTangents.slice(),outTangents:this.settings.outTangents.slice()}),s}};an.prototype.ValueTypeName="";an.prototype.TimeBufferType=Float32Array;an.prototype.ValueBufferType=Float32Array;an.prototype.DefaultInterpolation=ts;gi=class extends an{constructor(e,t,n){super(e,t,n)}};gi.prototype.ValueTypeName="bool";gi.prototype.ValueBufferType=Array;gi.prototype.DefaultInterpolation=es;gi.prototype.InterpolantFactoryMethodLinear=void 0;gi.prototype.InterpolantFactoryMethodSmooth=void 0;Qr=class extends an{constructor(e,t,n,s){super(e,t,n,s)}};Qr.prototype.ValueTypeName="color";Un=class extends an{constructor(e,t,n,s){super(e,t,n,s)}};Un.prototype.ValueTypeName="number";To=class extends jn{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=(n-t)/(s-t),c=e*o;for(let h=c+o;c!==h;c+=4)_e.slerpFlat(r,0,a,c-o,a,c,l);return r}},On=class extends an{constructor(e,t,n,s){super(e,t,n,s)}InterpolantFactoryMethodLinear(e){return new To(this.times,this.values,this.getValueSize(),e)}};On.prototype.ValueTypeName="quaternion";On.prototype.InterpolantFactoryMethodSmooth=void 0;_i=class extends an{constructor(e,t,n){super(e,t,n)}};_i.prototype.ValueTypeName="string";_i.prototype.ValueBufferType=Array;_i.prototype.DefaultInterpolation=es;_i.prototype.InterpolantFactoryMethodLinear=void 0;_i.prototype.InterpolantFactoryMethodSmooth=void 0;Di=class extends an{constructor(e,t,n,s){super(e,t,n,s)}};Di.prototype.ValueTypeName="vector";Qt=class{constructor(e="",t=-1,n=[],s=yl){this.name=e,this.tracks=n,this.duration=t,this.blendMode=s,this.uuid=Qn(),this.userData={},this.duration<0&&this.resetDuration()}static parse(e){let t=[],n=e.tracks,s=1/(e.fps||1);for(let a=0,o=n.length;a!==o;++a)t.push(e_(n[a]).scale(s));let r=new this(e.name,e.duration,t,e.blendMode);return r.uuid=e.uuid,r.userData=JSON.parse(e.userData||"{}"),r}static toJSON(e){let t=[],n=e.tracks,s={name:e.name,duration:e.duration,tracks:t,uuid:e.uuid,blendMode:e.blendMode,userData:JSON.stringify(e.userData)};for(let r=0,a=n.length;r!==a;++r)t.push(an.toJSON(n[r]));return s}static CreateFromMorphTargetSequence(e,t,n,s){let r=t.length,a=[];for(let o=0;o<r;o++){let l=[],c=[];l.push((o+r-1)%r,o,(o+1)%r),c.push(0,1,0);let h=zf(l);l=Gc(l,1,h),c=Gc(c,1,h),!s&&l[0]===0&&(l.push(r),c.push(c[0])),a.push(new Un(".morphTargetInfluences["+t[o].name+"]",l,c).scale(1/n))}return new this(e,-1,a)}static findByName(e,t){let n=e;if(!Array.isArray(e)){let s=e;n=s.geometry&&s.geometry.animations||s.animations}for(let s=0;s<n.length;s++)if(n[s].name===t)return n[s];return null}static CreateClipsFromMorphTargetSequences(e,t,n){let s={},r=/^([\w-]*?)([\d]+)$/;for(let o=0,l=e.length;o<l;o++){let c=e[o],h=c.name.match(r);if(h&&h.length>1){let u=h[1],d=s[u];d||(s[u]=d=[]),d.push(c)}}let a=[];for(let o in s)a.push(this.CreateFromMorphTargetSequence(o,s[o],t,n));return a}resetDuration(){let e=this.tracks,t=0;for(let n=0,s=e.length;n!==s;++n){let r=this.tracks[n];t=Math.max(t,r.times[r.times.length-1])}return this.duration=t,this}trim(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].trim(0,this.duration);return this}validate(){let e=!0;for(let t=0;t<this.tracks.length;t++)e=e&&this.tracks[t].validate();return e}optimize(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].optimize();return this}clone(){let e=[];for(let n=0;n<this.tracks.length;n++)e.push(this.tracks[n].clone());let t=new this.constructor(this.name,this.duration,e,this.blendMode);return t.userData=JSON.parse(JSON.stringify(this.userData)),t}toJSON(){return this.constructor.toJSON(this)}};qn={enabled:!1,files:{},add:function(i,e){this.enabled!==!1&&(Kd(i)||(this.files[i]=e))},get:function(i){if(this.enabled!==!1&&!Kd(i))return this.files[i]},remove:function(i){delete this.files[i]},clear:function(){this.files={}}};Ro=class{constructor(e,t,n){let s=this,r=!1,a=0,o=0,l,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this._abortController=null,this.itemStart=function(h){o++,r===!1&&s.onStart!==void 0&&s.onStart(h,a,o),r=!0},this.itemEnd=function(h){a++,s.onProgress!==void 0&&s.onProgress(h,a,o),a===o&&(r=!1,s.onLoad!==void 0&&s.onLoad())},this.itemError=function(h){s.onError!==void 0&&s.onError(h)},this.resolveURL=function(h){return h=h.normalize("NFC"),l?l(h):h},this.setURLModifier=function(h){return l=h,this},this.addHandler=function(h,u){return c.push(h,u),this},this.removeHandler=function(h){let u=c.indexOf(h);return u!==-1&&c.splice(u,2),this},this.getHandler=function(h){for(let u=0,d=c.length;u<d;u+=2){let f=c[u],m=c[u+1];if(f.global&&(f.lastIndex=0),f.test(h))return m}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},Wf=new Ro,Yn=class{constructor(e){this.manager=e!==void 0?e:Wf,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},this.priority="auto",this.cache="default",typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(e,t){let n=this;return new Promise(function(s,r){n.load(e,s,t,r)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}setPriority(e){return this.priority=e,this}setCache(e){return this.cache=e,this}abort(){return this}};Yn.DEFAULT_MATERIAL_NAME="__DEFAULT";ui={},Vc=class extends Error{constructor(e,t){super(e),this.response=t}},nr=class extends Yn{constructor(e){super(e),this.mimeType="",this.responseType="",this._abortController=new AbortController}load(e,t,n,s){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let r=qn.get(`file:${e}`);if(r!==void 0){this.manager.itemStart(e),setTimeout(()=>{t&&t(r),this.manager.itemEnd(e)},0);return}if(ui[e]!==void 0){ui[e].push({onLoad:t,onProgress:n,onError:s});return}ui[e]=[],ui[e].push({onLoad:t,onProgress:n,onError:s});let a=new Request(e,{headers:new Headers(this.requestHeader),credentials:this.withCredentials?"include":"same-origin",priority:this.priority,cache:this.cache,signal:typeof AbortSignal.any=="function"?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal}),o=this.mimeType,l=this.responseType;fetch(a).then(c=>{if(c.status===200||c.status===0){if(c.status===0&&Se("FileLoader: HTTP Status 0 received."),typeof ReadableStream>"u"||c.body===void 0||c.body.getReader===void 0)return c;let h=ui[e],u=c.body.getReader(),d=c.headers.get("X-File-Size")||c.headers.get("Content-Length"),f=d?parseInt(d):0,m=f!==0,b=0,g=new ReadableStream({start(p){x();function x(){u.read().then(({done:w,value:y})=>{if(w)p.close();else{b+=y.byteLength;let S=new ProgressEvent("progress",{lengthComputable:m,loaded:b,total:f});for(let E=0,_=h.length;E<_;E++){let A=h[E];A.onProgress&&A.onProgress(S)}p.enqueue(y),x()}},w=>{p.error(w)})}}});return new Response(g)}else throw new Vc(`fetch for "${c.url}" responded with ${c.status}: ${c.statusText}`,c)}).then(c=>{switch(l){case"arraybuffer":return c.arrayBuffer();case"blob":return c.blob();case"document":return c.text().then(h=>new DOMParser().parseFromString(h,o));case"json":return c.json();default:if(o==="")return c.text();{let u=/charset="?([^;"\s]*)"?/i.exec(o),d=u&&u[1]?u[1].toLowerCase():void 0,f=new TextDecoder(d);return c.arrayBuffer().then(m=>f.decode(m))}}}).then(c=>{qn.add(`file:${e}`,c);let h=ui[e];delete ui[e];for(let u=0,d=h.length;u<d;u++){let f=h[u];f.onLoad&&f.onLoad(c)}}).catch(c=>{let h=ui[e];if(h===void 0)throw this.manager.itemError(e),c;delete ui[e];for(let u=0,d=h.length;u<d;u++){let f=h[u];f.onError&&f.onError(c)}this.manager.itemError(e)}).finally(()=>{this.manager.itemEnd(e)}),this.manager.itemStart(e)}setResponseType(e){return this.responseType=e,this}setMimeType(e){return this.mimeType=e,this}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}},Us=new WeakMap,Co=class extends Yn{constructor(e){super(e)}load(e,t,n,s){this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let r=this,a=qn.get(`image:${e}`);if(a!==void 0){if(a.complete===!0)r.manager.itemStart(e),setTimeout(function(){t&&t(a),r.manager.itemEnd(e)},0);else{let u=Us.get(a);u===void 0&&(u=[],Us.set(a,u)),u.push({onLoad:t,onError:s})}return a}let o=qs("img");function l(){h(),t&&t(this);let u=Us.get(this)||[];for(let d=0;d<u.length;d++){let f=u[d];f.onLoad&&f.onLoad(this)}Us.delete(this),r.manager.itemEnd(e)}function c(u){h(),s&&s(u),qn.remove(`image:${e}`);let d=Us.get(this)||[];for(let f=0;f<d.length;f++){let m=d[f];m.onError&&m.onError(u)}Us.delete(this),r.manager.itemError(e),r.manager.itemEnd(e)}function h(){o.removeEventListener("load",l,!1),o.removeEventListener("error",c,!1)}return o.addEventListener("load",l,!1),o.addEventListener("error",c,!1),e.slice(0,5)!=="data:"&&this.crossOrigin!==void 0&&(o.crossOrigin=this.crossOrigin),qn.add(`image:${e}`,o),r.manager.itemStart(e),o.fetchPriority=this.priority,o.src=e,o}},ea=class extends Yn{constructor(e){super(e)}load(e,t,n,s){let r=new kt,a=new Co(this.manager);return a.setPriority(this.priority),a.setCache(this.cache),a.setCrossOrigin(this.crossOrigin),a.setPath(this.path),a.load(e,function(o){r.image=o,r.needsUpdate=!0,t!==void 0&&t(r)},n,s),r}},Ni=class extends nt{static registerNode(e){this.prototype._lightNode=e}constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new Ee(e),this.intensity=t}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,t}},Fi=class extends Ni{constructor(e,t,n){super(e,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(nt.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Ee(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}toJSON(e){let t=super.toJSON(e);return t.object.groundColor=this.groundColor.getHex(),t}},Uc=new ke,Jd=new L,$d=new L,ir=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Ie(512,512),this.mapType=ln,this.map=null,this.mapPass=null,this.matrix=new ke,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new ki,this._frameExtents=new Ie(1,1),this._viewportCount=1,this._viewports=[new et(0,0,1,1)]}getViewportCount(){return this._viewportCount}getCamera(){return this.camera}getFrustum(){return this._frustum}updateMatrices(e){let t=this.camera;Jd.setFromMatrixPosition(e.matrixWorld),t.position.copy(Jd),$d.setFromMatrixPosition(e.target.matrixWorld),t.lookAt($d),t.updateMatrixWorld(),this._updateMatrix(t,this.matrix,this._frustum)}_updateMatrix(e,t,n,s){Uc.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),n.setFromProjectionMatrix(Uc,e.coordinateSystem,e.reversedDepth);let r=this._frameExtents,a=s?s.z/r.x:1,o=s?s.w/r.y:1,l=s?s.x/r.x:0,c=s?s.y/r.y:0;e.coordinateSystem===Ws||e.reversedDepth?t.set(.5*a,0,0,.5*a+l,0,.5*o,0,.5*o+c,0,0,1,0,0,0,0,1):t.set(.5*a,0,0,.5*a+l,0,.5*o,0,.5*o+c,0,0,.5,.5,0,0,0,1),t.multiply(Uc)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.mapType=e.mapType,this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return e.intensity=this.intensity,e.bias=this.bias,e.normalBias=this.normalBias,e.radius=this.radius,e.blurSamples=this.blurSamples,e.mapSize=this.mapSize.toArray(),e.mapType=this.mapType,e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},io=new L,so=new _e,Wn=new L,ta=class extends nt{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new ke,this.projectionMatrix=new ke,this.projectionMatrixInverse=new ke,this.coordinateSystem=Mn,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(io,so,Wn),Wn.x===1&&Wn.y===1&&Wn.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(io,so,Wn.set(1,1,1)).invert()}updateWorldMatrix(e,t,n=!1){super.updateWorldMatrix(e,t,n),this.matrixWorld.decompose(io,so,Wn),Wn.x===1&&Wn.y===1&&Wn.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(io,so,Wn.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},Ci=new L,Zd=new Ie,Qd=new Ie,Mt=class extends ta{constructor(e=50,t=1,n=.1,s=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=s,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=ns*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(kr*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return ns*2*Math.atan(Math.tan(kr*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){Ci.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(Ci.x,Ci.y).multiplyScalar(-e/Ci.z),Ci.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Ci.x,Ci.y).multiplyScalar(-e/Ci.z)}getViewSize(e,t){return this.getViewBounds(e,Zd,Qd),t.subVectors(Qd,Zd)}setViewOffset(e,t,n,s,r,a){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(kr*.5*this.fov)/this.zoom,n=2*t,s=this.aspect*n,r=-.5*s,a=this.view;if(this.view!==null&&this.view.enabled){let l=a.fullWidth,c=a.fullHeight;r+=a.offsetX*s/l,t-=a.offsetY*n/c,s*=a.width/l,n*=a.height/c}let o=this.filmOffset;o!==0&&(r+=e*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+s,t,t-n,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}},Wc=class extends ir{constructor(){super(new Mt(50,1,.5,500)),this.isSpotLightShadow=!0,this.focus=1,this.aspect=1}updateMatrices(e){let t=this.camera,n=ns*2*e.angle*this.focus,s=this.mapSize.width/this.mapSize.height*this.aspect,r=e.distance||t.far;(n!==t.fov||s!==t.aspect||r!==t.far)&&(t.fov=n,t.aspect=s,t.far=r,t.updateProjectionMatrix()),super.updateMatrices(e)}copy(e){return super.copy(e),this.focus=e.focus,this.aspect=e.aspect,this}toJSON(){let e=super.toJSON();return e.focus=this.focus,e.aspect=this.aspect,e}},na=class extends Ni{constructor(e,t,n=0,s=Math.PI/3,r=0,a=2){super(e,t),this.isSpotLight=!0,this.type="SpotLight",this.position.copy(nt.DEFAULT_UP),this.updateMatrix(),this.target=new nt,this.distance=n,this.angle=s,this.penumbra=r,this.decay=a,this.map=null,this.shadow=new Wc}get power(){return this.intensity*Math.PI}set power(e){this.intensity=e/Math.PI}dispose(){super.dispose(),this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.angle=e.angle,this.penumbra=e.penumbra,this.decay=e.decay,this.target=e.target.clone(),this.map=e.map,this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.distance=this.distance,t.object.angle=this.angle,t.object.decay=this.decay,t.object.penumbra=this.penumbra,t.object.target=this.target.uuid,this.map&&this.map.isTexture&&(t.object.map=this.map.toJSON(e).uuid),t.object.shadow=this.shadow.toJSON(),t}},qc=class extends ir{constructor(){super(new Mt(90,1,.5,500)),this.isPointLightShadow=!0}},ia=class extends Ni{constructor(e,t,n=0,s=2){super(e,t),this.isPointLight=!0,this.type="PointLight",this.distance=n,this.decay=s,this.shadow=new qc}get power(){return this.intensity*4*Math.PI}set power(e){this.intensity=e/(4*Math.PI)}dispose(){super.dispose(),this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.decay=e.decay,this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.distance=this.distance,t.object.decay=this.decay,t.object.shadow=this.shadow.toJSON(),t}},Kn=class extends ta{constructor(e=-1,t=1,n=1,s=-1,r=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=s,this.near=r,this.far=a,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,s,r,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,s=(this.top+this.bottom)/2,r=n-e,a=n+e,o=s+t,l=s-t;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=c*this.view.offsetX,a=r+c*this.view.width,o-=h*this.view.offsetY,l=o-h*this.view.height}this.projectionMatrix.makeOrthographic(r,a,o,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},Xc=class extends ir{constructor(){super(new Kn(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},Jn=class extends Ni{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(nt.DEFAULT_UP),this.updateMatrix(),this.target=new nt,this.shadow=new Xc}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.shadow=this.shadow.toJSON(),t.object.target=this.target.uuid,t}},Ui=class extends Ni{constructor(e,t){super(e,t),this.isAmbientLight=!0,this.type="AmbientLight"}},bi=class{static extractUrlBase(e){let t=e.lastIndexOf("/");return t===-1?"./":e.slice(0,t+1)}static resolveURL(e,t){return typeof e!="string"||e===""?"":(/^https?:\/\//i.test(t)&&/^\//.test(e)&&(t=t.replace(/(^https?:\/\/[^\/]+).*/i,"$1")),/^(https?:)?\/\//i.test(e)||/^data:.*,.*$/i.test(e)||/^blob:.*$/i.test(e)?e:t+e)}},Oc=new WeakMap,sa=class extends Yn{constructor(e){super(e),this.isImageBitmapLoader=!0,typeof createImageBitmap>"u"&&Se("ImageBitmapLoader: createImageBitmap() not supported."),typeof fetch>"u"&&Se("ImageBitmapLoader: fetch() not supported."),this.options={premultiplyAlpha:"none"},this._abortController=new AbortController}setOptions(e){return this.options=e,this}load(e,t,n,s){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let r=this,a=qn.get(`image-bitmap:${e}`);if(a!==void 0){if(r.manager.itemStart(e),a.then){a.then(c=>{Oc.has(a)===!0?(s&&s(Oc.get(a)),r.manager.itemError(e),r.manager.itemEnd(e)):(t&&t(c),r.manager.itemEnd(e))});return}setTimeout(function(){t&&t(a),r.manager.itemEnd(e)},0);return}let o={};o.credentials=this.withCredentials||this.crossOrigin!=="anonymous"?"include":"same-origin",o.headers=this.requestHeader,o.priority=this.priority,o.cache=this.cache,o.signal=typeof AbortSignal.any=="function"?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal;let l=fetch(e,o).then(function(c){return c.blob()}).then(function(c){return createImageBitmap(c,Object.assign({},r.options,{colorSpaceConversion:"none"}))}).then(function(c){return qn.add(`image-bitmap:${e}`,c),t&&t(c),r.manager.itemEnd(e),c}).catch(function(c){s&&s(c),Oc.set(l,c),qn.remove(`image-bitmap:${e}`),r.manager.itemError(e),r.manager.itemEnd(e)});qn.add(`image-bitmap:${e}`,l),r.manager.itemStart(e)}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}},Os=-90,Bs=1,sr=class extends nt{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;let s=new Mt(Os,Bs,e,t);s.layers=this.layers,this.add(s);let r=new Mt(Os,Bs,e,t);r.layers=this.layers,this.add(r);let a=new Mt(Os,Bs,e,t);a.layers=this.layers,this.add(a);let o=new Mt(Os,Bs,e,t);o.layers=this.layers,this.add(o);let l=new Mt(Os,Bs,e,t);l.layers=this.layers,this.add(l);let c=new Mt(Os,Bs,e,t);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,t=this.children.concat(),[n,s,r,a,o,l]=t;for(let c of t)this.remove(c);if(e===Mn)n.up.set(0,1,0),n.lookAt(1,0,0),s.up.set(0,1,0),s.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===Ws)n.up.set(0,-1,0),n.lookAt(-1,0,0),s.up.set(0,-1,0),s.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let c of t)this.add(c),c.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();let{renderTarget:n,activeMipmapLevel:s}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[r,a,o,l,c,h]=this.children,u=e.getRenderTarget(),d=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),m=e.xr.enabled;e.xr.enabled=!1;let b=n.texture.mipmapsAutoUpdate;n.texture.mipmapsAutoUpdate=!1;let g=!1;e.isWebGLRenderer===!0?g=e.state.buffers.depth.getReversed():g=e.reversedDepthBuffer,e.setRenderTarget(n,0,s),g&&e.autoClear===!1&&e.clearDepth(),e.render(t,r),e.setRenderTarget(n,1,s),g&&e.autoClear===!1&&e.clearDepth(),e.render(t,a),e.setRenderTarget(n,2,s),g&&e.autoClear===!1&&e.clearDepth(),e.render(t,o),e.setRenderTarget(n,3,s),g&&e.autoClear===!1&&e.clearDepth(),e.render(t,l),e.setRenderTarget(n,4,s),g&&e.autoClear===!1&&e.clearDepth(),e.render(t,c),n.texture.mipmapsAutoUpdate=b,e.setRenderTarget(n,5,s),g&&e.autoClear===!1&&e.clearDepth(),e.render(t,h),e.setRenderTarget(u,d,f),e.xr.enabled=m,n.texture.needsPMREMUpdate=!0}},Lo=class extends Mt{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e,this.perCameraFrustumCulled=!1}},Oi=class{constructor(){this._previousTime=0,this._currentTime=0,this._startTime=performance.now(),this._delta=0,this._elapsed=0,this._timescale=1,this._document=null,this._pageVisibilityHandler=null}connect(e){this._document=e,e.hidden!==void 0&&(this._pageVisibilityHandler=t_.bind(this),e.addEventListener("visibilitychange",this._pageVisibilityHandler,!1))}disconnect(){this._pageVisibilityHandler!==null&&(this._document.removeEventListener("visibilitychange",this._pageVisibilityHandler),this._pageVisibilityHandler=null),this._document=null}getDelta(){return this._delta/1e3}getElapsed(){return this._elapsed/1e3}getTimescale(){return this._timescale}setTimescale(e){return this._timescale=e,this}reset(){return this._currentTime=performance.now()-this._startTime,this}dispose(){this.disconnect()}update(e){return this._pageVisibilityHandler!==null&&this._document.hidden===!0?this._delta=0:(this._previousTime=this._currentTime,this._currentTime=(e!==void 0?e:performance.now())-this._startTime,this._delta=(this._currentTime-this._previousTime)*this._timescale,this._elapsed+=this._delta),this}};Po=class{constructor(e,t,n){this.binding=e,this.valueSize=n;let s,r,a;switch(t){case"quaternion":s=this._slerp,r=this._slerpAdditive,a=this._setAdditiveIdentityQuaternion,this.buffer=new Float64Array(n*6),this._workIndex=5;break;case"string":case"bool":s=this._select,r=this._select,a=this._setAdditiveIdentityOther,this.buffer=new Array(n*5);break;default:s=this._lerp,r=this._lerpAdditive,a=this._setAdditiveIdentityNumeric,this.buffer=new Float64Array(n*5)}this._mixBufferRegion=s,this._mixBufferRegionAdditive=r,this._setIdentity=a,this._origIndex=3,this._addIndex=4,this.cumulativeWeight=0,this.cumulativeWeightAdditive=0,this.useCount=0,this.referenceCount=0}accumulate(e,t){let n=this.buffer,s=this.valueSize,r=e*s+s,a=this.cumulativeWeight;if(a===0){for(let o=0;o!==s;++o)n[r+o]=n[o];a=t}else{a+=t;let o=t/a;this._mixBufferRegion(n,r,0,o,s)}this.cumulativeWeight=a}accumulateAdditive(e){let t=this.buffer,n=this.valueSize,s=n*this._addIndex;this.cumulativeWeightAdditive===0&&this._setIdentity(),this._mixBufferRegionAdditive(t,s,0,e,n),this.cumulativeWeightAdditive+=e}apply(e){let t=this.valueSize,n=this.buffer,s=e*t+t,r=this.cumulativeWeight,a=this.cumulativeWeightAdditive,o=this.binding;if(this.cumulativeWeight=0,this.cumulativeWeightAdditive=0,r<1){let l=t*this._origIndex;this._mixBufferRegion(n,s,l,1-r,t)}a>0&&this._mixBufferRegionAdditive(n,s,this._addIndex*t,1,t);for(let l=t,c=t+t;l!==c;++l)if(n[l]!==n[l+t]){o.setValue(n,s);break}}saveOriginalState(){let e=this.binding,t=this.buffer,n=this.valueSize,s=n*this._origIndex;e.getValue(t,s);for(let r=n,a=s;r!==a;++r)t[r]=t[s+r%n];this._setIdentity(),this.cumulativeWeight=0,this.cumulativeWeightAdditive=0}restoreOriginalState(){let e=this.valueSize*3;this.binding.setValue(this.buffer,e)}_setAdditiveIdentityNumeric(){let e=this._addIndex*this.valueSize,t=e+this.valueSize;for(let n=e;n<t;n++)this.buffer[n]=0}_setAdditiveIdentityQuaternion(){this._setAdditiveIdentityNumeric(),this.buffer[this._addIndex*this.valueSize+3]=1}_setAdditiveIdentityOther(){let e=this._origIndex*this.valueSize,t=this._addIndex*this.valueSize;for(let n=0;n<this.valueSize;n++)this.buffer[t+n]=this.buffer[e+n]}_select(e,t,n,s,r){if(s>=.5)for(let a=0;a!==r;++a)e[t+a]=e[n+a]}_slerp(e,t,n,s){_e.slerpFlat(e,t,e,t,e,n,s)}_slerpAdditive(e,t,n,s,r){let a=this._workIndex*r;_e.multiplyQuaternionsFlat(e,a,e,t,e,n),_e.slerpFlat(e,t,e,t,e,a,s)}_lerp(e,t,n,s,r){let a=1-s;for(let o=0;o!==r;++o){let l=t+o;e[l]=e[l]*a+e[n+o]*s}}_lerpAdditive(e,t,n,s,r){for(let a=0;a!==r;++a){let o=t+a;e[o]=e[o]+e[n+a]*s}}},Th="\\[\\]\\.:\\/",n_=new RegExp("["+Th+"]","g"),Rh="[^"+Th+"]",i_="[^"+Th.replace("\\.","")+"]",s_=/((?:WC+[\/:])*)/.source.replace("WC",Rh),r_=/(WCOD+)?/.source.replace("WCOD",i_),a_=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Rh),o_=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Rh),l_=new RegExp("^"+s_+r_+a_+o_+"$"),c_=["material","materials","bones","map"],jc=class{constructor(e,t,n){let s=n||tt.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,s)}getValue(e,t){this.bind();let n=this._targetGroup.nCachedObjects_,s=this._bindings[n];s!==void 0&&s.getValue(e,t)}setValue(e,t){let n=this._bindings;for(let s=this._targetGroup.nCachedObjects_,r=n.length;s!==r;++s)n[s].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}},tt=class i{constructor(e,t,n){this.path=t,this.parsedPath=n||i.parseTrackName(t),this.node=i.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,n){return e&&e.isAnimationObjectGroup?new i.Composite(e,t,n):new i(e,t,n)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(n_,"")}static parseTrackName(e){let t=l_.exec(e);if(t===null)throw new Error("THREE.PropertyBinding: Cannot parse trackName: "+e);let n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},s=n.nodeName&&n.nodeName.lastIndexOf(".");if(s!==void 0&&s!==-1){let r=n.nodeName.substring(s+1);c_.indexOf(r)!==-1&&(n.nodeName=n.nodeName.substring(0,s),n.objectName=r)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("THREE.PropertyBinding: can not parse propertyName from trackName: "+e);return n}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){let n=function(r){for(let a=0;a<r.length;a++){let o=r[a];if(o.name===t||o.uuid===t)return o;let l=n(o.children);if(l)return l}return null},s=n(e.children);if(s)return s}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)e[t++]=n[s]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node,t=this.parsedPath,n=t.objectName,s=t.propertyName,r=t.propertyIndex;if(e||(e=i.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){Se("PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let c=t.objectIndex;switch(n){case"materials":if(!e.material){Pe("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){Pe("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){Pe("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let h=0;h<e.length;h++)if(e[h].name===c){c=h;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){Pe("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){Pe("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[n]===void 0){Pe("PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[n]}if(c!==void 0){if(e[c]===void 0){Pe("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}let a=e[s];if(a===void 0){let c=t.nodeName;Pe("PropertyBinding: Trying to update property for track: "+c+"."+s+" but it wasn't found.",e);return}let o=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?o=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(o=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(r!==void 0){if(s==="morphTargetInfluences"){if(!e.geometry){Pe("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){Pe("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[r]!==void 0&&(r=e.morphTargetDictionary[r])}l=this.BindingType.ArrayElement,this.resolvedProperty=a,this.propertyIndex=r}else a.fromArray!==void 0&&a.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=a):Array.isArray(a)?(l=this.BindingType.EntireArray,this.resolvedProperty=a):this.propertyName=s;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][o]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};tt.Composite=jc;tt.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};tt.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};tt.prototype.GetterByBindingType=[tt.prototype._getValue_direct,tt.prototype._getValue_array,tt.prototype._getValue_arrayElement,tt.prototype._getValue_toArray];tt.prototype.SetterByBindingTypeAndVersioning=[[tt.prototype._setValue_direct,tt.prototype._setValue_direct_setNeedsUpdate,tt.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[tt.prototype._setValue_array,tt.prototype._setValue_array_setNeedsUpdate,tt.prototype._setValue_array_setMatrixWorldNeedsUpdate],[tt.prototype._setValue_arrayElement,tt.prototype._setValue_arrayElement_setNeedsUpdate,tt.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[tt.prototype._setValue_fromArray,tt.prototype._setValue_fromArray_setNeedsUpdate,tt.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];Io=class{constructor(e,t,n=null,s=t.blendMode){this._mixer=e,this._clip=t,this._localRoot=n,this.blendMode=s;let r=t.tracks,a=r.length,o=new Array(a),l={endingStart:$i,endingEnd:$i};for(let c=0;c!==a;++c){let h=r[c].createInterpolant(null);o[c]=h,h.settings=l}this._interpolantSettings=l,this._interpolants=o,this._propertyBindings=new Array(a),this._cacheIndex=null,this._byClipCacheIndex=null,this._timeScaleInterpolant=null,this._restoreTimeScale=null,this._weightInterpolant=null,this.loop=ps,this._loopCount=-1,this._startTime=null,this.time=0,this.timeScale=1,this._effectiveTimeScale=1,this.weight=1,this._effectiveWeight=1,this.repetitions=1/0,this.paused=!1,this.enabled=!0,this.clampWhenFinished=!1,this.zeroSlopeAtStart=!0,this.zeroSlopeAtEnd=!0}play(){return this._mixer._activateAction(this),this}stop(){return this._mixer._deactivateAction(this),this.reset()}reset(){return this.paused=!1,this.enabled=!0,this.time=0,this._loopCount=-1,this._startTime=null,this.stopFading().stopWarping()}isRunning(){return this.enabled&&!this.paused&&this.timeScale!==0&&this._startTime===null&&this._mixer._isActiveAction(this)}isScheduled(){return this._mixer._isActiveAction(this)}startAt(e){return this._startTime=e,this}setLoop(e,t){return this.loop=e,this.repetitions=t,this}setEffectiveWeight(e){return this.weight=e,this._effectiveWeight=this.enabled?e:0,this.stopFading()}getEffectiveWeight(){return this._effectiveWeight}fadeIn(e){return this._scheduleFading(e,0,1)}fadeOut(e){return this._scheduleFading(e,1,0)}crossFadeFrom(e,t,n=!1){if(e.fadeOut(t),this.fadeIn(t),n===!0){let s=this._clip.duration,r=e._clip.duration,a=r/s,o=s/r;e._restoreTimeScale=e.timeScale,this._restoreTimeScale=this.timeScale,e.warp(1,a,t),this.warp(o,1,t)}return this}crossFadeTo(e,t,n=!1){return e.crossFadeFrom(this,t,n)}stopFading(){let e=this._weightInterpolant;return e!==null&&(this._weightInterpolant=null,this._mixer._takeBackControlInterpolant(e)),this}setEffectiveTimeScale(e){return this.timeScale=e,this._effectiveTimeScale=this.paused?0:e,this.stopWarping()}getEffectiveTimeScale(){return this._effectiveTimeScale}setDuration(e){return this.timeScale=this._clip.duration/e,this.stopWarping()}syncWith(e){return this.time=e.time,this.timeScale=e.timeScale,this.stopWarping()}halt(e){return this.warp(this._effectiveTimeScale,0,e)}warp(e,t,n){let s=this._mixer,r=s.time,a=this.timeScale,o=this._timeScaleInterpolant;o===null&&(o=s._lendControlInterpolant(),this._timeScaleInterpolant=o);let l=o.parameterPositions,c=o.sampleValues;return l[0]=r,l[1]=r+n,c[0]=e/a,c[1]=t/a,this}stopWarping(){let e=this._timeScaleInterpolant;return e!==null&&(this._timeScaleInterpolant=null,this._mixer._takeBackControlInterpolant(e)),this._restoreTimeScale=null,this}getMixer(){return this._mixer}getClip(){return this._clip}getRoot(){return this._localRoot||this._mixer._root}_update(e,t,n,s){if(!this.enabled){this._updateWeight(e);return}let r=this._startTime;if(r!==null){let l=(e-r)*n;l<0||n===0?t=0:(this._startTime=null,t=n*l)}t*=this._updateTimeScale(e);let a=this._updateTime(t),o=this._updateWeight(e);if(o>0){let l=this._interpolants,c=this._propertyBindings;switch(this.blendMode){case da:for(let h=0,u=l.length;h!==u;++h)l[h].evaluate(a),c[h].accumulateAdditive(o);break;case yl:default:for(let h=0,u=l.length;h!==u;++h)l[h].evaluate(a),c[h].accumulate(s,o)}}}_updateWeight(e){let t=0;if(this.enabled){t=this.weight;let n=this._weightInterpolant;if(n!==null){let s=n.evaluate(e)[0];t*=s,e>n.parameterPositions[1]&&(this.stopFading(),s===0&&(this.enabled=!1))}}return this._effectiveWeight=t,t}_updateTimeScale(e){let t=0;if(!this.paused){t=this.timeScale;let n=this._timeScaleInterpolant;if(n!==null){let s=n.evaluate(e)[0];t*=s,e>n.parameterPositions[1]&&(t===0?this.paused=!0:(this._restoreTimeScale!==null&&(t=this._restoreTimeScale),this.timeScale=t),this.stopWarping())}}return this._effectiveTimeScale=t,t}_updateTime(e){let t=this._clip.duration,n=this.loop,s=this.time+e,r=this._loopCount,a=n===Af;if(e===0)return r===-1?s:a&&(r&1)===1?t-s:s;if(n===Hi){r===-1&&(this._loopCount=0,this._setEndings(!0,!0,!1));e:{if(s>=t)s=t;else if(s<0)s=0;else{this.time=s;break e}this.clampWhenFinished?this.paused=!0:this.enabled=!1,this.time=s,this._mixer.dispatchEvent({type:"finished",action:this,direction:e<0?-1:1})}}else{if(r===-1&&(e>=0?(r=0,this._setEndings(!0,this.repetitions===0,a)):this._setEndings(this.repetitions===0,!0,a)),s>=t||s<0){let o=Math.floor(s/t);s-=t*o,r+=Math.abs(o);let l=this.repetitions-r;if(l<=0)this.clampWhenFinished?this.paused=!0:this.enabled=!1,s=e>0?t:0,this.time=s,this._mixer.dispatchEvent({type:"finished",action:this,direction:e>0?1:-1});else{if(l===1){let c=e<0;this._setEndings(c,!c,a)}else this._setEndings(!1,!1,a);this._loopCount=r,this.time=s,this._mixer.dispatchEvent({type:"loop",action:this,loopDelta:o})}}else this._loopCount=r,this.time=s;if(a&&(r&1)===1)return t-s}return s}_setEndings(e,t,n){let s=this._interpolantSettings;n?(s.endingStart=Zi,s.endingEnd=Zi):(e?s.endingStart=this.zeroSlopeAtStart?Zi:$i:s.endingStart=Nr,t?s.endingEnd=this.zeroSlopeAtEnd?Zi:$i:s.endingEnd=Nr)}_scheduleFading(e,t,n){let s=this._mixer,r=s.time,a=this._weightInterpolant;a===null&&(a=s._lendControlInterpolant(),this._weightInterpolant=a);let o=a.parameterPositions,l=a.sampleValues;return o[0]=r,l[0]=t,o[1]=r+e,l[1]=n,this}},h_=new Float32Array(1),ls=class extends Fn{constructor(e){super(),this._root=e,this._initMemoryManager(),this._accuIndex=0,this.time=0,this.timeScale=1,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}_bindAction(e,t){let n=e._localRoot||this._root,s=e._clip.tracks,r=s.length,a=e._propertyBindings,o=e._interpolants,l=n.uuid,c=this._bindingsByRootAndName,h=c[l];h===void 0&&(h={},c[l]=h);for(let u=0;u!==r;++u){let d=s[u],f=d.name,m=h[f];if(m!==void 0)++m.referenceCount,a[u]=m;else{if(m=a[u],m!==void 0){m._cacheIndex===null&&(++m.referenceCount,this._addInactiveBinding(m,l,f));continue}let b=t&&t._propertyBindings[u].binding.parsedPath;m=new Po(tt.create(n,f,b),d.ValueTypeName,d.getValueSize()),++m.referenceCount,this._addInactiveBinding(m,l,f),a[u]=m}o[u].resultBuffer=m.buffer}}_activateAction(e){if(!this._isActiveAction(e)){if(e._cacheIndex===null){let n=(e._localRoot||this._root).uuid,s=e._clip.uuid,r=this._actionsByClip[s];this._bindAction(e,r&&r.knownActions[0]),this._addInactiveAction(e,s,n)}let t=e._propertyBindings;for(let n=0,s=t.length;n!==s;++n){let r=t[n];r.useCount++===0&&(this._lendBinding(r),r.saveOriginalState())}this._lendAction(e)}}_deactivateAction(e){if(this._isActiveAction(e)){let t=e._propertyBindings;for(let n=0,s=t.length;n!==s;++n){let r=t[n];--r.useCount===0&&(r.restoreOriginalState(),this._takeBackBinding(r))}this._takeBackAction(e)}}_initMemoryManager(){this._actions=[],this._nActiveActions=0,this._actionsByClip={},this._bindings=[],this._nActiveBindings=0,this._bindingsByRootAndName={},this._controlInterpolants=[],this._nActiveControlInterpolants=0;let e=this;this.stats={actions:{get total(){return e._actions.length},get inUse(){return e._nActiveActions}},bindings:{get total(){return e._bindings.length},get inUse(){return e._nActiveBindings}},controlInterpolants:{get total(){return e._controlInterpolants.length},get inUse(){return e._nActiveControlInterpolants}}}}_isActiveAction(e){let t=e._cacheIndex;return t!==null&&t<this._nActiveActions}_addInactiveAction(e,t,n){let s=this._actions,r=this._actionsByClip,a=r[t];if(a===void 0)a={knownActions:[e],actionByRoot:{}},e._byClipCacheIndex=0,r[t]=a;else{let o=a.knownActions;e._byClipCacheIndex=o.length,o.push(e)}e._cacheIndex=s.length,s.push(e),a.actionByRoot[n]=e}_removeInactiveAction(e){let t=this._actions,n=t[t.length-1],s=e._cacheIndex;n._cacheIndex=s,t[s]=n,t.pop(),e._cacheIndex=null;let r=e._clip.uuid,a=this._actionsByClip,o=a[r],l=o.knownActions,c=l[l.length-1],h=e._byClipCacheIndex;c._byClipCacheIndex=h,l[h]=c,l.pop(),e._byClipCacheIndex=null;let u=o.actionByRoot,d=(e._localRoot||this._root).uuid;delete u[d],l.length===0&&delete a[r],this._removeInactiveBindingsForAction(e)}_removeInactiveBindingsForAction(e){let t=e._propertyBindings;for(let n=0,s=t.length;n!==s;++n){let r=t[n];--r.referenceCount===0&&this._removeInactiveBinding(r)}}_lendAction(e){let t=this._actions,n=e._cacheIndex,s=this._nActiveActions++,r=t[s];e._cacheIndex=s,t[s]=e,r._cacheIndex=n,t[n]=r}_takeBackAction(e){let t=this._actions,n=e._cacheIndex,s=--this._nActiveActions,r=t[s];e._cacheIndex=s,t[s]=e,r._cacheIndex=n,t[n]=r}_addInactiveBinding(e,t,n){let s=this._bindingsByRootAndName,r=this._bindings,a=s[t];a===void 0&&(a={},s[t]=a),a[n]=e,e._cacheIndex=r.length,r.push(e)}_removeInactiveBinding(e){let t=this._bindings,n=e.binding,s=n.rootNode.uuid,r=n.path,a=this._bindingsByRootAndName,o=a[s],l=t[t.length-1],c=e._cacheIndex;l._cacheIndex=c,t[c]=l,t.pop(),delete o[r],Object.keys(o).length===0&&delete a[s]}_lendBinding(e){let t=this._bindings,n=e._cacheIndex,s=this._nActiveBindings++,r=t[s];e._cacheIndex=s,t[s]=e,r._cacheIndex=n,t[n]=r}_takeBackBinding(e){let t=this._bindings,n=e._cacheIndex,s=--this._nActiveBindings,r=t[s];e._cacheIndex=s,t[s]=e,r._cacheIndex=n,t[n]=r}_lendControlInterpolant(){let e=this._controlInterpolants,t=this._nActiveControlInterpolants++,n=e[t];return n===void 0&&(n=new Zr(new Float32Array(2),new Float32Array(2),1,h_),n.__cacheIndex=t,e[t]=n),n}_takeBackControlInterpolant(e){let t=this._controlInterpolants,n=e.__cacheIndex,s=--this._nActiveControlInterpolants,r=t[s];e.__cacheIndex=s,t[s]=e,r.__cacheIndex=n,t[n]=r}clipAction(e,t,n){let s=t||this._root,r=s.uuid,a=typeof e=="string"?Qt.findByName(s,e):e,o=a!==null?a.uuid:e,l=this._actionsByClip[o],c=null;if(n===void 0&&(a!==null?n=a.blendMode:n=yl),l!==void 0){let u=l.actionByRoot[r];if(u!==void 0&&u.blendMode===n)return u;c=l.knownActions[0],a===null&&(a=c._clip)}if(a===null)return null;let h=new Io(this,a,t,n);return this._bindAction(h,c),this._addInactiveAction(h,o,r),h}existingAction(e,t){let n=t||this._root,s=n.uuid,r=typeof e=="string"?Qt.findByName(n,e):e,a=r?r.uuid:e,o=this._actionsByClip[a];return o!==void 0&&o.actionByRoot[s]||null}stopAllAction(){let e=this._actions,t=this._nActiveActions;for(let n=t-1;n>=0;--n)e[n].stop();return this}update(e){e*=this.timeScale;let t=this._actions,n=this._nActiveActions,s=this.time+=e,r=Math.sign(e),a=this._accuIndex^=1;for(let c=0;c!==n;++c)t[c]._update(s,e,r,a);let o=this._bindings,l=this._nActiveBindings;for(let c=0;c!==l;++c)o[c].apply(a);return this}setTime(e){this.time=0;for(let t=0;t<this._actions.length;t++)this._actions[t].time=0;return this.update(e)}getRoot(){return this._root}uncacheClip(e){let t=this._actions,n=e.uuid,s=this._actionsByClip,r=s[n];if(r!==void 0){let a=r.knownActions;for(let o=0,l=a.length;o!==l;++o){let c=a[o];this._deactivateAction(c);let h=c._cacheIndex,u=t[t.length-1];c._cacheIndex=null,c._byClipCacheIndex=null,u._cacheIndex=h,t[h]=u,t.pop(),this._removeInactiveBindingsForAction(c)}delete s[n]}}uncacheRoot(e){let t=e.uuid,n=this._actionsByClip;for(let a in n){let o=n[a].actionByRoot,l=o[t];l!==void 0&&(this._deactivateAction(l),this._removeInactiveAction(l))}let s=this._bindingsByRootAndName,r=s[t];if(r!==void 0)for(let a in r){let o=r[a];o.restoreOriginalState(),this._removeInactiveBinding(o)}}uncacheAction(e,t){let n=this.existingAction(e,t);n!==null&&(this._deactivateAction(n),this._removeInactiveAction(n))}},rr=class{constructor(e,t,n,s,r,a=!1){this.isGLBufferAttribute=!0,this.name="",this.buffer=e,this.type=t,this.itemSize=n,this.elementSize=s,this.count=r,this.normalized=a,this.version=0}set needsUpdate(e){e===!0&&this.version++}setBuffer(e){return this.buffer=e,this}setType(e,t){return this.type=e,this.elementSize=t,this}setItemSize(e){return this.itemSize=e,this}setCount(e){return this.count=e,this}},Dh=class Dh{constructor(e,t,n,s){this.elements=[1,0,0,1],e!==void 0&&this.set(e,t,n,s)}identity(){return this.set(1,0,0,1),this}fromArray(e,t=0){for(let n=0;n<4;n++)this.elements[n]=e[n+t];return this}set(e,t,n,s){let r=this.elements;return r[0]=e,r[2]=t,r[1]=n,r[3]=s,this}};Dh.prototype.isMatrix2=!0;Yc=Dh;typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:"187"}}));typeof window<"u"&&(window.__THREE__?Se("WARNING: Multiple instances of Three.js being imported."):window.__THREE__="187")});function dp(){let i=null,e=!1,t=null,n=null;function s(r,a){n=i.requestAnimationFrame(s),t(r,a)}return{start:function(){e!==!0&&t!==null&&i!==null&&(n=i.requestAnimationFrame(s),e=!0)},stop:function(){i!==null&&i.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(r){t=r},setContext:function(r){i=r}}}function f_(i){let e=new WeakMap;function t(o,l){let c=o.array,h=o.usage,u=c.byteLength,d=i.createBuffer();i.bindBuffer(l,d),i.bufferData(l,c,h),o.onUploadCallback();let f;if(c instanceof Float32Array)f=i.FLOAT;else if(typeof Float16Array<"u"&&c instanceof Float16Array)f=i.HALF_FLOAT;else if(c instanceof Uint16Array)o.isFloat16BufferAttribute?f=i.HALF_FLOAT:f=i.UNSIGNED_SHORT;else if(c instanceof Int16Array)f=i.SHORT;else if(c instanceof Uint32Array)f=i.UNSIGNED_INT;else if(c instanceof Int32Array)f=i.INT;else if(c instanceof Int8Array)f=i.BYTE;else if(c instanceof Uint8Array)f=i.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)f=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:d,type:f,bytesPerElement:c.BYTES_PER_ELEMENT,version:o.version,size:u}}function n(o,l,c){let h=l.array,u=l.updateRanges;if(i.bindBuffer(c,o),u.length===0)i.bufferSubData(c,0,h);else{u.sort((f,m)=>f.start-m.start);let d=0;for(let f=1;f<u.length;f++){let m=u[d],b=u[f];b.start<=m.start+m.count+1?m.count=Math.max(m.count,b.start+b.count-m.start):(++d,u[d]=b)}u.length=d+1;for(let f=0,m=u.length;f<m;f++){let b=u[f];i.bufferSubData(c,b.start*h.BYTES_PER_ELEMENT,h,b.start,b.count)}l.clearUpdateRanges()}l.onUploadCallback()}function s(o){return o.isInterleavedBufferAttribute&&(o=o.data),e.get(o)}function r(o){o.isInterleavedBufferAttribute&&(o=o.data);let l=e.get(o);l&&(i.deleteBuffer(l.buffer),e.delete(o))}function a(o,l){if(o.isInterleavedBufferAttribute&&(o=o.data),o.isGLBufferAttribute){let h=e.get(o);(!h||h.version<o.version)&&e.set(o,{buffer:o.buffer,type:o.type,bytesPerElement:o.elementSize,version:o.version});return}let c=e.get(o);if(c===void 0)e.set(o,t(o,l));else if(c.version<o.version){if(c.size!==o.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(c.buffer,o,l),c.version=o.version}}return{get:s,remove:r,update:a}}function Yx(i,e,t,n,s,r){let a=new Ee(0),o=s===!0?0:1,l,c,h=null,u=0,d=null;function f(x){let w=x.isScene===!0?x.background:null;if(w&&w.isTexture){let y=x.backgroundBlurriness>0;w=e.get(w,y)}return w}function m(x){let w=!1,y=f(x);y===null?g(a,o):y&&y.isColor&&(g(y,1),w=!0);let S=i.xr.getEnvironmentBlendMode();S==="additive"?t.buffers.color.setClear(0,0,0,1,r):S==="alpha-blend"&&t.buffers.color.setClear(0,0,0,0,r),(i.autoClear||w)&&(t.buffers.depth.setTest(!0),t.buffers.depth.setMask(!0),t.buffers.color.setMask(!0),i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil))}function b(x,w){let y=f(w);y&&y.isCubeTexture?(c===void 0&&(c=new Bt(new tr(1,1,1),new Xn({name:"BackgroundCubeMaterial",uniforms:ms(ti.backgroundCube.uniforms),vertexShader:ti.backgroundCube.vertexShader,fragmentShader:ti.backgroundCube.fragmentShader,side:en,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),c.geometry.deleteAttribute("uv"),c.onBeforeRender=function(S,E,_){this.matrixWorld.copyPosition(_.matrixWorld)},Object.defineProperty(c.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),n.update(c)),c.material.uniforms.envMap.value=y,c.material.uniforms.backgroundBlurriness.value=w.backgroundBlurriness,c.material.uniforms.backgroundIntensity.value=w.backgroundIntensity,c.material.uniforms.backgroundRotation.value.setFromMatrix4(jx.makeRotationFromEuler(w.backgroundRotation)).transpose(),y.isRenderTargetTexture===!1&&c.material.uniforms.backgroundRotation.value.premultiply(fp),c.material.toneMapped=Ge.getTransfer(y.colorSpace)!==$e,(h!==y||u!==y.version||d!==i.toneMapping)&&(c.material.needsUpdate=!0,h=y,u=y.version,d=i.toneMapping),c.layers.enableAll(),x.unshift(c,c.geometry,c.material,0,0,null)):y&&y.isTexture&&(l===void 0&&(l=new Bt(new Jr(2,2),new Xn({name:"BackgroundMaterial",uniforms:ms(ti.background.uniforms),vertexShader:ti.background.vertexShader,fragmentShader:ti.background.fragmentShader,side:$n,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),n.update(l)),l.material.uniforms.t2D.value=y,l.material.uniforms.backgroundIntensity.value=w.backgroundIntensity,l.material.toneMapped=Ge.getTransfer(y.colorSpace)!==$e,y.matrixAutoUpdate===!0&&y.updateMatrix(),l.material.uniforms.uvTransform.value.copy(y.matrix),(h!==y||u!==y.version||d!==i.toneMapping)&&(l.material.needsUpdate=!0,h=y,u=y.version,d=i.toneMapping),l.layers.enableAll(),x.unshift(l,l.geometry,l.material,0,0,null))}function g(x,w){x.getRGB(Ml,Eh(i)),t.buffers.color.setClear(Ml.r,Ml.g,Ml.b,w,r)}function p(){c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return a},setClearColor:function(x,w=1){a.set(x),o=w,g(a,o)},getClearAlpha:function(){return o},setClearAlpha:function(x){o=x,g(a,o)},render:m,addToRenderList:b,dispose:p}}function Kx(i,e){let t=i.getParameter(i.MAX_VERTEX_ATTRIBS),n={},s=d(null),r=s,a=!1;function o(D,B,W,I,G){let j=!1,z=u(D,I,W,B);r!==z&&(r=z,c(r.object)),j=f(D,I,W,G),j&&m(D,I,W,G),G!==null&&e.update(G,i.ELEMENT_ARRAY_BUFFER),(j||a)&&(a=!1,y(D,B,W,I),G!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,e.get(G).buffer))}function l(){return i.createVertexArray()}function c(D){return i.bindVertexArray(D)}function h(D){return i.deleteVertexArray(D)}function u(D,B,W,I){let G=I.wireframe===!0,j=n[B.id];j===void 0&&(j={},n[B.id]=j);let z=D.isInstancedMesh===!0?D.id:0,te=j[z];te===void 0&&(te={},j[z]=te);let q=te[W.id];q===void 0&&(q={},te[W.id]=q);let Z=q[G];return Z===void 0&&(Z=d(l()),q[G]=Z),Z}function d(D){let B=[],W=[],I=[];for(let G=0;G<t;G++)B[G]=0,W[G]=0,I[G]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:B,enabledAttributes:W,attributeDivisors:I,object:D,attributes:{},index:null}}function f(D,B,W,I){let G=r.attributes,j=B.attributes,z=0,te=W.getAttributes();for(let q in te)if(te[q].location>=0){let Q=G[q],we=j[q];if(we===void 0&&(q==="instanceMatrix"&&D.instanceMatrix&&(we=D.instanceMatrix),q==="instanceColor"&&D.instanceColor&&(we=D.instanceColor)),Q===void 0||Q.attribute!==we||we&&Q.data!==we.data)return!0;z++}return r.attributesNum!==z||r.index!==I}function m(D,B,W,I){let G={},j=B.attributes,z=0,te=W.getAttributes();for(let q in te)if(te[q].location>=0){let Q=j[q];Q===void 0&&(q==="instanceMatrix"&&D.instanceMatrix&&(Q=D.instanceMatrix),q==="instanceColor"&&D.instanceColor&&(Q=D.instanceColor));let we={};we.attribute=Q,Q&&Q.data&&(we.data=Q.data),G[q]=we,z++}r.attributes=G,r.attributesNum=z,r.index=I}function b(){let D=r.newAttributes;for(let B=0,W=D.length;B<W;B++)D[B]=0}function g(D){p(D,0)}function p(D,B){let W=r.newAttributes,I=r.enabledAttributes,G=r.attributeDivisors;W[D]=1,I[D]===0&&(i.enableVertexAttribArray(D),I[D]=1),G[D]!==B&&(i.vertexAttribDivisor(D,B),G[D]=B)}function x(){let D=r.newAttributes,B=r.enabledAttributes;for(let W=0,I=B.length;W<I;W++)B[W]!==D[W]&&(i.disableVertexAttribArray(W),B[W]=0)}function w(D,B,W,I,G,j,z){z===!0?i.vertexAttribIPointer(D,B,W,G,j):i.vertexAttribPointer(D,B,W,I,G,j)}function y(D,B,W,I){b();let G=I.attributes,j=W.getAttributes(),z=B.defaultAttributeValues;for(let te in j){let q=j[te];if(q.location>=0){let Z=G[te];if(Z===void 0&&(te==="instanceMatrix"&&D.instanceMatrix&&(Z=D.instanceMatrix),te==="instanceColor"&&D.instanceColor&&(Z=D.instanceColor)),Z!==void 0){let Q=Z.normalized,we=Z.itemSize,Fe=e.get(Z);if(Fe===void 0)continue;let K=Fe.buffer,pe=Fe.type,xe=Fe.bytesPerElement,Re=pe===i.INT||pe===i.UNSIGNED_INT||Z.gpuType===Uo;if(Z.isInterleavedBufferAttribute){let me=Z.data,Oe=me.isInterleavedBuffer===!0?me.stride:me.itemSize,mt=Z.offset;if(me.isInstancedInterleavedBuffer||me.isInstancedBufferAttribute){for(let Le=0;Le<q.locationSize;Le++)p(q.location+Le,me.meshPerAttribute);D.isInstancedMesh!==!0&&I._maxInstanceCount===void 0&&(I._maxInstanceCount=me.meshPerAttribute*me.count)}else for(let Le=0;Le<q.locationSize;Le++)g(q.location+Le);i.bindBuffer(i.ARRAY_BUFFER,K);for(let Le=0;Le<q.locationSize;Le++)w(q.location+Le,we/q.locationSize,pe,Q,Oe*xe,(mt+we/q.locationSize*Le)*xe,Re)}else{if(Z.isInstancedBufferAttribute){for(let me=0;me<q.locationSize;me++)p(q.location+me,Z.meshPerAttribute);D.isInstancedMesh!==!0&&I._maxInstanceCount===void 0&&(I._maxInstanceCount=Z.meshPerAttribute*Z.count)}else for(let me=0;me<q.locationSize;me++)g(q.location+me);i.bindBuffer(i.ARRAY_BUFFER,K);for(let me=0;me<q.locationSize;me++)w(q.location+me,we/q.locationSize,pe,Q,we*xe,we/q.locationSize*me*xe,Re)}}else if(z!==void 0){let Q=z[te];if(Q!==void 0)switch(Q.length){case 2:i.vertexAttrib2fv(q.location,Q);break;case 3:i.vertexAttrib3fv(q.location,Q);break;case 4:i.vertexAttrib4fv(q.location,Q);break;default:i.vertexAttrib1fv(q.location,Q)}}}}x()}function S(){k();for(let D in n){let B=n[D];for(let W in B){let I=B[W];for(let G in I){let j=I[G];for(let z in j)h(j[z].object),delete j[z];delete I[G]}}delete n[D]}}function E(D){if(n[D.id]===void 0)return;let B=n[D.id];for(let W in B){let I=B[W];for(let G in I){let j=I[G];for(let z in j)h(j[z].object),delete j[z];delete I[G]}}delete n[D.id]}function _(D){for(let B in n){let W=n[B];for(let I in W){let G=W[I];if(G[D.id]===void 0)continue;let j=G[D.id];for(let z in j)h(j[z].object),delete j[z];delete G[D.id]}}}function A(D){for(let B in n){let W=n[B],I=D.isInstancedMesh===!0?D.id:0,G=W[I];if(G!==void 0){for(let j in G){let z=G[j];for(let te in z)h(z[te].object),delete z[te];delete G[j]}delete W[I],Object.keys(W).length===0&&delete n[B]}}}function k(){R(),a=!0,r!==s&&(r=s,c(r.object))}function R(){s.geometry=null,s.program=null,s.wireframe=!1}return{setup:o,reset:k,resetDefaultState:R,dispose:S,releaseStatesOfGeometry:E,releaseStatesOfObject:A,releaseStatesOfProgram:_,initAttributes:b,enableAttribute:g,disableUnusedAttributes:x}}function Jx(i,e,t){let n;function s(l){n=l}function r(l,c){i.drawArrays(n,l,c),t.update(c,n,1)}function a(l,c,h){h!==0&&(i.drawArraysInstanced(n,l,c,h),t.update(c,n,h))}function o(l,c,h){if(h===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,l,0,c,0,h);let d=0;for(let f=0;f<h;f++)d+=c[f];t.update(d,n,1)}this.setMode=s,this.render=r,this.renderInstances=a,this.renderMultiDraw=o}function $x(i,e,t,n){let s;function r(){if(s!==void 0)return s;if(e.has("EXT_texture_filter_anisotropic")===!0){let _=e.get("EXT_texture_filter_anisotropic");s=i.getParameter(_.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else s=0;return s}function a(_){return!(_!==En&&n.convert(_)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_FORMAT))}function o(_){let A=_===Hn&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(_!==ln&&_!==fn&&!A&&n.convert(_)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_TYPE))}function l(_){if(_==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";_="mediump"}return _==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=t.precision!==void 0?t.precision:"highp",h=l(c);h!==c&&(Se("WebGLRenderer:",c,"not supported, using",h,"instead."),c=h);let u=t.reversedDepthBuffer===!0&&e.has("EXT_clip_control"),d=t.logarithmicDepthBuffer===!0&&u===!1;t.reversedDepthBuffer===!0&&u===!1&&Se("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer."),t.logarithmicDepthBuffer===!0&&u===!0&&Se("WebGLRenderer: Logarithmic depth buffer is ignored when reversed depth buffer is enabled.");let f=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),m=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),b=i.getParameter(i.MAX_TEXTURE_SIZE),g=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),p=i.getParameter(i.MAX_VERTEX_ATTRIBS),x=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),w=i.getParameter(i.MAX_VARYING_VECTORS),y=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),S=i.getParameter(i.MAX_SAMPLES),E=i.getParameter(i.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:l,textureFormatReadable:a,textureTypeReadable:o,precision:c,logarithmicDepthBuffer:d,reversedDepthBuffer:u,maxTextures:f,maxVertexTextures:m,maxTextureSize:b,maxCubemapSize:g,maxAttributes:p,maxVertexUniforms:x,maxVaryings:w,maxFragmentUniforms:y,maxSamples:S,samples:E}}function Zx(i){let e=this,t=null,n=0,s=!1,r=!1,a=new Dn,o=new De,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(u,d){let f=u.length!==0||d||n!==0||s;return s=d,n=u.length,f},this.beginShadows=function(){r=!0,h(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(u,d){t=h(u,d,0)},this.setState=function(u,d,f){let m=u.clippingPlanes,b=u.clipIntersection,g=u.clipShadows,p=i.get(u);if(!s||m===null||m.length===0||r&&!g)r?h(null):c();else{let x=r?0:n,w=x*4,y=p.clippingState||null;l.value=y,y=h(m,d,w,f);for(let S=0;S!==w;++S)y[S]=t[S];p.clippingState=y,this.numIntersection=b?this.numPlanes:0,this.numPlanes+=x}};function c(){l.value!==t&&(l.value=t,l.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function h(u,d,f,m){let b=u!==null?u.length:0,g=null;if(b!==0){if(g=l.value,m!==!0||g===null){let p=f+b*4,x=d.matrixWorldInverse;o.getNormalMatrix(x),(g===null||g.length<p)&&(g=new Float32Array(p));for(let w=0,y=f;w!==b;++w,y+=4)a.copy(u[w]).applyMatrix4(x,o),a.normal.toArray(g,y),g[y+3]=a.constant}l.value=g,l.needsUpdate=!0}return e.numPlanes=b,e.numIntersection=0,g}}function Xf(i,e,t){return new ga(i,{minFilter:An,generateMipmaps:e,type:Hn,colorSpace:Jt,depthBuffer:t})}function _a(i,e,t){return new Xn({name:i,uniforms:e,vertexShader:ze.cube_vert,fragmentShader:t,side:en,blending:cs,depthTest:!1,depthWrite:!1})}function sy(){return _a("PMREMGGXConvolution",{envMap:{value:null},roughness:{value:0},lodBias:{value:0}},`

		#define GGX_SAMPLES ${pp}u

		varying vec3 vWorldDirection;

		uniform samplerCube envMap;
		uniform float roughness;
		uniform float lodBias;

		#include <common>

		// Van der Corput radical inverse
		float radicalInverse_VdC( uint bits ) {

			bits = ( bits << 16u ) | ( bits >> 16u );
			bits = ( ( bits & 0x55555555u ) << 1u ) | ( ( bits & 0xAAAAAAAAu ) >> 1u );
			bits = ( ( bits & 0x33333333u ) << 2u ) | ( ( bits & 0xCCCCCCCCu ) >> 2u );
			bits = ( ( bits & 0x0F0F0F0Fu ) << 4u ) | ( ( bits & 0xF0F0F0F0u ) >> 4u );
			bits = ( ( bits & 0x00FF00FFu ) << 8u ) | ( ( bits & 0xFF00FF00u ) >> 8u );
			return float( bits ) * 2.3283064365386963e-10; // / 0x100000000

		}

		// Hammersley sequence
		vec2 hammersley( uint i, uint N ) {

			return vec2( float( i ) / float( N ), radicalInverse_VdC( i ) );

		}

		void main() {

			vec3 N = normalize( vWorldDirection );

			// For very low roughness, just sample the environment directly
			if ( roughness < 0.001 ) {

				gl_FragColor = vec4( textureLod( envMap, N, 0.0 ).rgb, 1.0 );
				return;

			}

			float alpha = roughness * roughness;
			float alpha2 = alpha * alpha;

			// Tangent space basis for VNDF sampling
			vec3 up = abs( N.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
			vec3 tangent = normalize( cross( up, N ) );
			vec3 bitangent = cross( N, tangent );

			vec3 prefilteredColor = vec3( 0.0 );
			float totalWeight = 0.0;

			for ( uint i = 0u; i < GGX_SAMPLES; i ++ ) {

				vec2 Xi = hammersley( i, GGX_SAMPLES );

				// With V = N, sample the reflected direction directly.
				float invQ = 1.0 / ( 1.0 - Xi.x + alpha2 * Xi.x );
				float NdotL = ( 1.0 - Xi.x - alpha2 * Xi.x ) * invQ;

				if ( NdotL > 0.0 ) {

					float phi = 2.0 * PI * Xi.y;
					float sinTheta = 2.0 * alpha * sqrt( Xi.x * ( 1.0 - Xi.x ) ) * invQ;
					vec3 L = N * NdotL + ( tangent * cos( phi ) + bitangent * sin( phi ) ) * sinTheta;

					// Match the source mip to the sample's solid angle. The terms
					// independent of the sample are precomputed in lodBias.
					float d = alpha2 * invQ;
					float lod = max( log2( d ) + lodBias, 0.0 );

					// Weight by NdotL for the split-sum approximation
					prefilteredColor += textureLod( envMap, L, lod ).rgb * NdotL;
					totalWeight += NdotL;

				}

			}

			gl_FragColor = vec4( prefilteredColor / totalWeight, 1.0 );

		}
	`)}function ry(){return _a("PMREMGGXIntegration",{envMap:{value:null},roughness:{value:0},sourceLod:{value:0},sourceSize:{value:mp}},`

		varying vec3 vWorldDirection;

		uniform samplerCube envMap;
		uniform float roughness;
		uniform float sourceLod;
		uniform int sourceSize;

		void main() {

			vec3 N = normalize( vWorldDirection );

			float alpha = roughness * roughness;
			float alpha2 = alpha * alpha;

			float texelSize = 2.0 / float( sourceSize );

			vec3 prefilteredColor = vec3( 0.0 );
			float totalWeight = 0.0;

			// Pair opposite texels: only the one in N's hemisphere contributes.
			for ( int face = 0; face < 3; face ++ ) {

				for ( int y = 0; y < sourceSize; y ++ ) {

					for ( int x = 0; x < sourceSize; x ++ ) {

						vec2 uv = ( vec2( x, y ) + 0.5 ) * texelSize - 1.0;
						vec3 texelDirection = face == 0 ? vec3( 1.0, uv ) : ( face == 1 ? vec3( uv.x, 1.0, uv.y ) : vec3( uv, 1.0 ) );

						float invDistance = inversesqrt( 1.0 + dot( uv, uv ) );
						float NdotL = dot( N, texelDirection );
						texelDirection *= NdotL < 0.0 ? - 1.0 : 1.0;
						NdotL = abs( NdotL ) * invDistance;

						// With V = N, NdotH squared is ( 1 + NdotL ) / 2. Common factors
						// in the GGX distribution and texel solid angle cancel when normalized.
						float d = 1.0 + alpha2 + ( alpha2 - 1.0 ) * NdotL;
						float weight = NdotL * invDistance * invDistance * invDistance / ( d * d );

						prefilteredColor += textureLod( envMap, texelDirection, sourceLod ).rgb * weight;
						totalWeight += weight;

					}

				}

			}

			gl_FragColor = vec4( prefilteredColor / totalWeight, 1.0 );

		}
	`)}function ay(){return _a("PMREMSphericalGaussianBlur",{envMap:{value:null},sigma:{value:0}},`

		#define SAMPLES ${ey}
		#define GOLDEN_ANGLE 2.39996322973

		varying vec3 vWorldDirection;

		uniform samplerCube envMap;
		uniform float sigma;

		#include <common>

		void main() {

			vec3 outputDirection = normalize( vWorldDirection );

			vec3 up = abs( outputDirection.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
			vec3 tangent = normalize( cross( up, outputDirection ) );
			vec3 bitangent = cross( outputDirection, tangent );

			// Truncate the kernel at three standard deviations or at the antipode.
			float thetaMax = min( 3.0 * sigma, PI );
			float truncation = 1.0 - exp( - 0.5 * thetaMax * thetaMax / ( sigma * sigma ) );

			vec3 accumColor = vec3( 0.0 );
			float accumWeight = 0.0;

			for ( int i = 0; i < SAMPLES; i ++ ) {

				// Stratified inverse-CDF sampling of the Gaussian, placed on a golden-angle spiral.
				float stratum = ( float( i ) + 0.5 ) / float( SAMPLES );
				float theta = sigma * sqrt( - 2.0 * log( 1.0 - stratum * truncation ) );
				float phi = float( i ) * GOLDEN_ANGLE;

				vec3 offset = cos( phi ) * tangent + sin( phi ) * bitangent;
				vec3 sampleDirection = cos( theta ) * outputDirection + sin( theta ) * offset;

				// Correct the planar sample density to solid angle.
				float weight = sin( theta ) / theta;

				accumColor += weight * textureLod( envMap, sampleDirection, 0.0 ).rgb;
				accumWeight += weight;

			}

			gl_FragColor = vec4( accumColor / accumWeight, 1.0 );

		}
	`)}function jf(){return _a("PMREMEquirectangularToCubemap",{envMap:{value:null}},`

		varying vec3 vWorldDirection;

		uniform sampler2D envMap;

		#include <common>

		void main() {

			// Average four subpixel samples to preserve small, bright features.
			vec3 direction = normalize( vWorldDirection );
			vec3 dx = dFdx( direction ) * 0.25;
			vec3 dy = dFdy( direction ) * 0.25;

			vec3 color = textureLod( envMap, equirectUv( normalize( direction - dx - dy ) ), 0.0 ).rgb;
			color += textureLod( envMap, equirectUv( normalize( direction + dx - dy ) ), 0.0 ).rgb;
			color += textureLod( envMap, equirectUv( normalize( direction - dx + dy ) ), 0.0 ).rgb;
			color += textureLod( envMap, equirectUv( normalize( direction + dx + dy ) ), 0.0 ).rgb;
			gl_FragColor = vec4( color * 0.25, 1.0 );

		}
	`)}function Yf(){return _a("PMREMCubemapToCubemap",{envMap:{value:null},flipEnvMap:{value:-1}},`

		varying vec3 vWorldDirection;

		uniform samplerCube envMap;
		uniform float flipEnvMap;

		void main() {

			gl_FragColor = vec4( textureCube( envMap, vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) ).rgb, 1.0 );

		}
	`)}function oy(i){let e=new WeakMap,t=new WeakMap,n=null;function s(d,f=!1){return d==null?null:f?a(d):r(d)}function r(d){if(d&&d.isTexture){let f=d.mapping;if(f===Do||f===No)if(e.has(d)){let m=e.get(d).texture;return o(m,d.mapping)}else{let m=d.image;if(m&&m.height>0){let b=new ga(m.height);return b.fromEquirectangularTexture(i,d),e.set(d,b),d.addEventListener("dispose",c),o(b.texture,d.mapping)}else return null}}return d}function a(d){if(d&&d.isTexture&&d.isPMREMTexture!==!0){let f=d.mapping,m=f===Do||f===No,b=f===us||f===lr;if(m||b){let g=t.get(d),p=g!==void 0?g.texture.pmremVersion:0;if(d.isRenderTargetTexture&&d.pmremVersion!==p)return n===null&&(n=new Al(i)),g=m?n.fromEquirectangular(d,g):n.fromCubemap(d,g),g.texture.pmremVersion=d.pmremVersion,t.set(d,g),g.texture;if(g!==void 0)return g.texture;{let x=d.image;return m&&x&&x.height>0||b&&x&&l(x)?(n===null&&(n=new Al(i)),g=m?n.fromEquirectangular(d):n.fromCubemap(d),g.texture.pmremVersion=d.pmremVersion,t.set(d,g),d.addEventListener("dispose",h),g.texture):null}}}return d}function o(d,f){return f===Do?d.mapping=us:f===No&&(d.mapping=lr),d}function l(d){let f=0,m=6;for(let b=0;b<m;b++)d[b]!==void 0&&f++;return f===m}function c(d){let f=d.target;f.removeEventListener("dispose",c);let m=e.get(f);m!==void 0&&(e.delete(f),m.dispose())}function h(d){let f=d.target;f.removeEventListener("dispose",h);let m=t.get(f);m!==void 0&&(t.delete(f),m.dispose())}function u(){e=new WeakMap,t=new WeakMap,n!==null&&(n.dispose(),n=null)}return{get:s,dispose:u}}function ly(i){let e={};function t(n){if(e[n]!==void 0)return e[n];let s=i.getExtension(n);return e[n]=s,s}return{has:function(n){return t(n)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(n){let s=t(n);return s===null&&Qi("WebGLRenderer: "+n+" extension not supported."),s}}}function cy(i,e,t,n){let s={},r=new WeakMap,a=new FinalizationRegistry(m=>delete s[m]);function o(m){l(m.target)}function l(m){m.index!==null&&e.remove(m.index);for(let g in m.attributes)e.remove(m.attributes[g]);m.removeEventListener("dispose",o),delete s[m.id],a.unregister(m);let b=r.get(m);b&&(e.remove(b),r.delete(m)),n.releaseStatesOfGeometry(m),m.isInstancedBufferGeometry===!0&&delete m._maxInstanceCount,t.memory.geometries--}function c(m,b){return s[b.id]!==void 0||(b.addEventListener("dispose",o),s[b.id]=new WeakRef(b),a.register(b,b.id,b),t.memory.geometries++),b}function h(m){let b=m.attributes;for(let g in b)e.update(b[g],i.ARRAY_BUFFER)}function u(m){let b=m.index,g=m.attributes.position,p=0;if(g===void 0)return;let x=b!==null?b.array.length:g.array.length/3-1,w=g.count>=65535?zr:Hr,y=new w(Math.ceil(x/3)*6,1),S=y.array;if(b!==null){let _=b.array;p=b.version;for(let A=0,k=0;A<x;A+=3){let R=_[A+0],D=_[A+1],B=_[A+2];S[k++]=R,S[k++]=D,S[k++]=D,S[k++]=B,S[k++]=B,S[k++]=R}}else{p=g.version;for(let _=0,A=0;_<x;_+=3){let k=_+0,R=_+1,D=_+2;S[A++]=k,S[A++]=R,S[A++]=R,S[A++]=D,S[A++]=D,S[A++]=k}}y.version=p;let E=r.get(m);E&&e.remove(E),r.set(m,y)}function d(m){let b=r.get(m);if(b){let g=m.index;g!==null&&b.version<g.version&&u(m)}else u(m);return r.get(m)}function f(){for(let m in s){let b=s[m].deref();b!==void 0&&l(b)}}return{get:c,update:h,getWireframeAttribute:d,dispose:f}}function hy(i,e,t){let n;function s(u){n=u}let r,a;function o(u){r=u.type,a=u.bytesPerElement}function l(u,d){i.drawElements(n,d,r,u*a),t.update(d,n,1)}function c(u,d,f){f!==0&&(i.drawElementsInstanced(n,d,r,u*a,f),t.update(d,n,f))}function h(u,d,f){if(f===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,d,0,r,u,0,f);let b=0;for(let g=0;g<f;g++)b+=d[g];t.update(b,n,1)}this.setMode=s,this.setIndex=o,this.render=l,this.renderInstances=c,this.renderMultiDraw=h}function uy(i){let e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,a,o){switch(t.calls++,a){case i.TRIANGLES:t.triangles+=o*(r/3);break;case i.LINES:t.lines+=o*(r/2);break;case i.LINE_STRIP:t.lines+=o*(r-1);break;case i.LINE_LOOP:t.lines+=o*r;break;case i.POINTS:t.points+=o*r;break;default:Pe("WebGLInfo: Unknown draw mode:",a);break}}function s(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:s,update:n}}function dy(i,e,t){let n=new WeakMap,s=new et;function r(a,o,l){let c=a.morphTargetInfluences,h=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,u=h!==void 0?h.length:0,d=n.get(o);if(d===void 0||d.count!==u){let k=function(){_.dispose(),n.delete(o),o.removeEventListener("dispose",k)};d!==void 0&&d.texture.dispose();let f=o.morphAttributes.position!==void 0,m=o.morphAttributes.normal!==void 0,b=o.morphAttributes.color!==void 0,g=o.morphAttributes.position||[],p=o.morphAttributes.normal||[],x=o.morphAttributes.color||[],w=0;f===!0&&(w=1),m===!0&&(w=2),b===!0&&(w=3);let y=o.attributes.position.count*w,S=1;y>e.maxTextureSize&&(S=Math.ceil(y/e.maxTextureSize),y=e.maxTextureSize);let E=new Float32Array(y*S*4*u),_=new Or(E,y,S,u);_.type=fn,_.needsUpdate=!0;let A=w*4;for(let R=0;R<u;R++){let D=g[R],B=p[R],W=x[R],I=y*S*4*R;for(let G=0;G<D.count;G++){let j=G*A;f===!0&&(s.fromBufferAttribute(D,G),E[I+j+0]=s.x,E[I+j+1]=s.y,E[I+j+2]=s.z,E[I+j+3]=0),m===!0&&(s.fromBufferAttribute(B,G),E[I+j+4]=s.x,E[I+j+5]=s.y,E[I+j+6]=s.z,E[I+j+7]=0),b===!0&&(s.fromBufferAttribute(W,G),E[I+j+8]=s.x,E[I+j+9]=s.y,E[I+j+10]=s.z,E[I+j+11]=W.itemSize===4?s.w:1)}}d={count:u,texture:_,size:new Ie(y,S)},n.set(o,d),o.addEventListener("dispose",k)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)l.getUniforms().setValue(i,"morphTexture",a.morphTexture,t);else{let f=0;for(let b=0;b<c.length;b++)f+=c[b];let m=o.morphTargetsRelative?1:1-f;l.getUniforms().setValue(i,"morphTargetBaseInfluence",m),l.getUniforms().setValue(i,"morphTargetInfluences",c)}l.getUniforms().setValue(i,"morphTargetsTexture",d.texture,t),l.getUniforms().setValue(i,"morphTargetsTextureSize",d.size)}return{update:r}}function fy(i,e,t,n,s){let r=new WeakMap;function a(c){let h=s.render.frame,u=c.geometry,d=e.get(c,u);if(r.get(d)!==h&&(e.update(d),r.set(d,h)),c.isInstancedMesh&&(c.hasEventListener("dispose",l)===!1&&c.addEventListener("dispose",l),r.get(c)!==h&&(t.update(c.instanceMatrix,i.ARRAY_BUFFER),c.instanceColor!==null&&t.update(c.instanceColor,i.ARRAY_BUFFER),r.set(c,h))),c.isSkinnedMesh){let f=c.skeleton;r.get(f)!==h&&(f.update(),r.set(f,h))}return d}function o(){r=new WeakMap}function l(c){let h=c.target;h.removeEventListener("dispose",l),n.releaseStatesOfObject(h),t.remove(h.instanceMatrix),h.instanceColor!==null&&t.remove(h.instanceColor)}return{update:a,dispose:o}}function my(i,e,t,n,s,r){let a=new dn(e,t,{type:i,depthBuffer:s,stencilBuffer:r,samples:n?4:0,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,resolveDepthBuffer:!1,resolveStencilBuffer:!1}),o=null,l=null,c=null,h=new $t;h.setAttribute("position",new It([-1,3,0,-1,-1,0,3,-1,0],3)),h.setAttribute("uv",new It([0,2,0,0,2,0],2));let u=new vo({uniforms:{tDiffuse:{value:null}},vertexShader:`
			precision highp float;

			uniform mat4 modelViewMatrix;
			uniform mat4 projectionMatrix;

			attribute vec3 position;
			attribute vec2 uv;

			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`,fragmentShader:`
			precision highp float;

			uniform sampler2D tDiffuse;

			varying vec2 vUv;

			#include <tonemapping_pars_fragment>
			#include <colorspace_pars_fragment>

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );

				#ifdef LINEAR_TONE_MAPPING
					gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
				#elif defined( REINHARD_TONE_MAPPING )
					gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
				#elif defined( CINEON_TONE_MAPPING )
					gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
				#elif defined( ACES_FILMIC_TONE_MAPPING )
					gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
				#elif defined( AGX_TONE_MAPPING )
					gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
				#elif defined( NEUTRAL_TONE_MAPPING )
					gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
				#elif defined( CUSTOM_TONE_MAPPING )
					gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
				#endif

				#ifdef SRGB_TRANSFER
					gl_FragColor = sRGBTransferOETF( gl_FragColor );
				#endif
			}`,depthTest:!1,depthWrite:!1}),d=new Bt(h,u),f=new Kn(-1,1,1,-1,0,1),m=null,b=null,g=!1,p,x=null,w=[],y=!1;this.setSize=function(S,E){a.setSize(S,E),o!==null&&o.setSize(S,E),l!==null&&l.setSize(S,E);for(let _=0;_<w.length;_++){let A=w[_];A.setSize&&A.setSize(S,E)}},this.setEffects=function(S){w=S,y=w.length>0&&w[0].isRenderPass===!0;let E=a.width,_=a.height;w.length>0&&o===null&&(o=new dn(E,_,{type:Hn,depthBuffer:!1,stencilBuffer:!1}),l=new dn(E,_,{type:Hn,depthBuffer:!1,stencilBuffer:!1}));let A=s===!0&&w.some(k=>k.needsDepthTexture===!0);A!==(a.depthTexture!==null)&&(A===!0&&c===null&&(c=new mi(E,_),r===!0&&(c.format=xi,c.type=fs)),a.dispose(),a.depthTexture=A?c:null,a.resolveDepthBuffer=A,a.storeMultisampledDepthBuffer=A);for(let k=0;k<w.length;k++){let R=w[k];R.setSize&&R.setSize(E,_),A&&R.needsDepthTexture===!0&&R.setDepthTexture&&R.setDepthTexture(c)}},this.begin=function(S,E){if(g||S.toneMapping===Zn&&w.length===0)return!1;if(x=E,E!==null){let _=E.width,A=E.height;(a.width!==_||a.height!==A)&&this.setSize(_,A)}return y===!1&&S.setRenderTarget(a),p=S.toneMapping,S.toneMapping=Zn,!0},this.hasRenderPass=function(){return y},this.end=function(S,E){S.toneMapping=p,g=!0;let _=a,A=o;for(let k=0;k<w.length;k++){let R=w[k];R.enabled!==!1&&(R.render(S,A,_,E),R.needsSwap!==!1&&(_=A,A=A===o?l:o))}if(m!==S.outputColorSpace||b!==S.toneMapping){m=S.outputColorSpace,b=S.toneMapping,u.defines={},Ge.getTransfer(m)===$e&&(u.defines.SRGB_TRANSFER="");let k=py[b];k&&(u.defines[k]=""),u.needsUpdate=!0}u.uniforms.tDiffuse.value=_.texture,S.setRenderTarget(x),S.render(d,f),x=null,g=!1},this.isCompositing=function(){return g},this.dispose=function(){a.dispose(),o!==null&&o.dispose(),l!==null&&l.dispose(),h.dispose(),u.dispose()}}function fr(i,e,t){let n=i[0];if(n<=0||n>0)return i;let s=e*t,r=Kf[s];if(r===void 0&&(r=new Float32Array(s),Kf[s]=r),e!==0){n.toArray(r,0);for(let a=1,o=0;a!==e;++a)o+=t,i[a].toArray(r,o)}return r}function At(i,e){if(i.length!==e.length)return!1;for(let t=0,n=i.length;t<n;t++)if(i[t]!==e[t])return!1;return!0}function Et(i,e){for(let t=0,n=e.length;t<n;t++)i[t]=e[t]}function El(i,e){let t=Jf[e];t===void 0&&(t=new Int32Array(e),Jf[e]=t);for(let n=0;n!==e;++n)t[n]=i.allocateTextureUnit();return t}function gy(i,e){let t=this.cache;t[0]!==e&&(i.uniform1f(this.addr,e),t[0]=e)}function _y(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(At(t,e))return;i.uniform2fv(this.addr,e),Et(t,e)}}function by(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(i.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(At(t,e))return;i.uniform3fv(this.addr,e),Et(t,e)}}function xy(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(At(t,e))return;i.uniform4fv(this.addr,e),Et(t,e)}}function yy(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(At(t,e))return;i.uniformMatrix2fv(this.addr,!1,e),Et(t,e)}else{if(At(t,n))return;Qf.set(n),i.uniformMatrix2fv(this.addr,!1,Qf),Et(t,n)}}function vy(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(At(t,e))return;i.uniformMatrix3fv(this.addr,!1,e),Et(t,e)}else{if(At(t,n))return;Zf.set(n),i.uniformMatrix3fv(this.addr,!1,Zf),Et(t,n)}}function wy(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(At(t,e))return;i.uniformMatrix4fv(this.addr,!1,e),Et(t,e)}else{if(At(t,n))return;$f.set(n),i.uniformMatrix4fv(this.addr,!1,$f),Et(t,n)}}function My(i,e){let t=this.cache;t[0]!==e&&(i.uniform1i(this.addr,e),t[0]=e)}function Sy(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(At(t,e))return;i.uniform2iv(this.addr,e),Et(t,e)}}function Ay(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(At(t,e))return;i.uniform3iv(this.addr,e),Et(t,e)}}function Ey(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(At(t,e))return;i.uniform4iv(this.addr,e),Et(t,e)}}function Ty(i,e){let t=this.cache;t[0]!==e&&(i.uniform1ui(this.addr,e),t[0]=e)}function Ry(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(At(t,e))return;i.uniform2uiv(this.addr,e),Et(t,e)}}function Cy(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(At(t,e))return;i.uniform3uiv(this.addr,e),Et(t,e)}}function Ly(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(At(t,e))return;i.uniform4uiv(this.addr,e),Et(t,e)}}function Tl(i){return i.version===0&&(i.compareFunction=xh,i.needsUpdate=!0),i}function Py(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s);let r;this.type===i.SAMPLER_2D_SHADOW?r=Tl(_p):r=gp,t.setTexture2D(e||r,s)}function Iy(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture3D(e||yp,s)}function ky(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s);let r;this.type===i.SAMPLER_CUBE_SHADOW?r=Tl(bp):r=vp,t.setTextureCube(e||r,s)}function Dy(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture2DArray(e||xp,s)}function Ny(i){switch(i){case 5126:return gy;case 35664:return _y;case 35665:return by;case 35666:return xy;case 35674:return yy;case 35675:return vy;case 35676:return wy;case 5124:case 35670:return My;case 35667:case 35671:return Sy;case 35668:case 35672:return Ay;case 35669:case 35673:return Ey;case 5125:return Ty;case 36294:return Ry;case 36295:return Cy;case 36296:return Ly;case 35678:case 36198:case 36298:case 36306:case 35682:return Py;case 35679:case 36299:case 36307:return Iy;case 35680:case 36300:case 36308:case 36293:return ky;case 36289:case 36303:case 36311:case 36292:return Dy}}function Fy(i,e){i.uniform1fv(this.addr,e)}function Uy(i,e){let t=fr(e,this.size,2);i.uniform2fv(this.addr,t)}function Oy(i,e){let t=fr(e,this.size,3);i.uniform3fv(this.addr,t)}function By(i,e){let t=fr(e,this.size,4);i.uniform4fv(this.addr,t)}function Hy(i,e){let t=fr(e,this.size,4);i.uniformMatrix2fv(this.addr,!1,t)}function zy(i,e){let t=fr(e,this.size,9);i.uniformMatrix3fv(this.addr,!1,t)}function Gy(i,e){let t=fr(e,this.size,16);i.uniformMatrix4fv(this.addr,!1,t)}function Vy(i,e){i.uniform1iv(this.addr,e)}function Wy(i,e){i.uniform2iv(this.addr,e)}function qy(i,e){i.uniform3iv(this.addr,e)}function Xy(i,e){i.uniform4iv(this.addr,e)}function jy(i,e){i.uniform1uiv(this.addr,e)}function Yy(i,e){i.uniform2uiv(this.addr,e)}function Ky(i,e){i.uniform3uiv(this.addr,e)}function Jy(i,e){i.uniform4uiv(this.addr,e)}function $y(i,e,t){let n=this.cache,s=e.length,r=El(t,s);At(n,r)||(i.uniform1iv(this.addr,r),Et(n,r));let a;this.type===i.SAMPLER_2D_SHADOW?a=Tl(_p):a=gp;for(let o=0;o!==s;++o)t.setTexture2D(e[o]||a,r[o])}function Zy(i,e,t){let n=this.cache,s=e.length,r=El(t,s);At(n,r)||(i.uniform1iv(this.addr,r),Et(n,r));for(let a=0;a!==s;++a)t.setTexture3D(e[a]||yp,r[a])}function Qy(i,e,t){let n=this.cache,s=e.length,r=El(t,s);At(n,r)||(i.uniform1iv(this.addr,r),Et(n,r));let a;this.type===i.SAMPLER_CUBE_SHADOW?a=Tl(bp):a=vp;for(let o=0;o!==s;++o)t.setTextureCube(e[o]||a,r[o])}function ev(i,e,t){let n=this.cache,s=e.length,r=El(t,s);At(n,r)||(i.uniform1iv(this.addr,r),Et(n,r));for(let a=0;a!==s;++a)t.setTexture2DArray(e[a]||xp,r[a])}function tv(i){switch(i){case 5126:return Fy;case 35664:return Uy;case 35665:return Oy;case 35666:return By;case 35674:return Hy;case 35675:return zy;case 35676:return Gy;case 5124:case 35670:return Vy;case 35667:case 35671:return Wy;case 35668:case 35672:return qy;case 35669:case 35673:return Xy;case 5125:return jy;case 36294:return Yy;case 36295:return Ky;case 36296:return Jy;case 35678:case 36198:case 36298:case 36306:case 35682:return $y;case 35679:case 36299:case 36307:return Zy;case 35680:case 36300:case 36308:case 36293:return Qy;case 36289:case 36303:case 36311:case 36292:return ev}}function ep(i,e){i.seq.push(e),i.map[e.id]=e}function nv(i,e,t){let n=i.name,s=n.length;for(Fh.lastIndex=0;;){let r=Fh.exec(n),a=Fh.lastIndex,o=r[1],l=r[2]==="]",c=r[3];if(l&&(o=o|0),c===void 0||c==="["&&a+2===s){ep(t,c===void 0?new Oh(o,i,e):new Bh(o,i,e));break}else{let u=t.map[o];u===void 0&&(u=new Hh(o),ep(t,u)),t=u}}}function tp(i,e,t){let n=i.createShader(e);return i.shaderSource(n,t),i.compileShader(n),n}function rv(i,e){let t=i.split(`
`),n=[],s=Math.max(e-6,0),r=Math.min(e+6,t.length);for(let a=s;a<r;a++){let o=a+1;n.push(`${o===e?">":" "} ${o}: ${t[a]}`)}return n.join(`
`)}function av(i){Ge._getMatrix(np,Ge.workingColorSpace,i);let e=`mat3( ${np.elements.map(t=>t.toFixed(4))} )`;switch(Ge.getTransfer(i)){case Fr:return[e,"LinearTransferOETF"];case $e:return[e,"sRGBTransferOETF"];default:return Se("WebGLProgram: Unsupported color space: ",i),[e,"LinearTransferOETF"]}}function ip(i,e,t){let n=i.getShaderParameter(e,i.COMPILE_STATUS),r=(i.getShaderInfoLog(e)||"").trim();if(n&&r==="")return"";let a=/ERROR: 0:(\d+)/.exec(r);if(a){let o=parseInt(a[1]);return t.toUpperCase()+`

`+r+`

`+rv(i.getShaderSource(e),o)}else return r}function ov(i,e){let t=av(e);return[`vec4 ${i}( vec4 value ) {`,`	return ${t[1]}( vec4( ${t[0]} * value.rgb, value.a ) );`,"}"].join(`
`)}function cv(i,e){let t=lv[e];return t===void 0?(Se("WebGLProgram: Unsupported toneMapping:",e),"vec3 "+i+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+i+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}function hv(){Ge.getLuminanceCoefficients(Sl);let i=Sl.x.toFixed(4),e=Sl.y.toFixed(4),t=Sl.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${i}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function uv(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",i.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(ma).join(`
`)}function dv(i){let e=[];for(let t in i){let n=i[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function fv(i,e){let t={},n=i.getProgramParameter(e,i.ACTIVE_ATTRIBUTES);for(let s=0;s<n;s++){let r=i.getActiveAttrib(e,s),a=r.name,o=1;r.type===i.FLOAT_MAT2&&(o=2),r.type===i.FLOAT_MAT3&&(o=3),r.type===i.FLOAT_MAT4&&(o=4),t[a]={type:r.type,location:i.getAttribLocation(e,a),locationSize:o}}return t}function ma(i){return i!==""}function sp(i,e){let t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return i.replace(/NUM_SUN_LIGHTS/g,e.numSunLights).replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_SUN_LIGHT_SHADOWS/g,e.numSunLightShadows).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows).replace(/NUM_LIGHT_PROBE_GRIDS/g,e.numLightProbeGrids)}function rp(i,e){return i.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}function zh(i){return i.replace(pv,mv)}function mv(i,e){let t=ze[e];if(t===void 0)throw new Error("THREE.WebGLProgram: Can not resolve #include <"+e+">");return zh(t)}function ap(i){return i.replace(gv,_v)}function _v(i,e,t,n){let s="";for(let r=parseInt(e);r<parseInt(t);r++)s+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return s}function op(i){let e=`precision ${i.precision} float;
	precision ${i.precision} int;
	precision ${i.precision} sampler2D;
	precision ${i.precision} samplerCube;
	precision ${i.precision} sampler3D;
	precision ${i.precision} sampler2DArray;
	precision ${i.precision} sampler2DShadow;
	precision ${i.precision} samplerCubeShadow;
	precision ${i.precision} sampler2DArrayShadow;
	precision ${i.precision} isampler2D;
	precision ${i.precision} isampler3D;
	precision ${i.precision} isamplerCube;
	precision ${i.precision} isampler2DArray;
	precision ${i.precision} usampler2D;
	precision ${i.precision} usampler3D;
	precision ${i.precision} usamplerCube;
	precision ${i.precision} usampler2DArray;
	`;return i.precision==="highp"?e+=`
#define HIGH_PRECISION`:i.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:i.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function xv(i){return bv[i.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}function vv(i){return i.envMap===!1?"ENVMAP_MODE_REFLECTION":yv[i.envMapMode]||"ENVMAP_MODE_REFLECTION"}function Mv(i){return i.envMap===!1?"ENVMAP_BLENDING_NONE":wv[i.combine]||"ENVMAP_BLENDING_NONE"}function Sv(i,e,t,n){let s=i.getContext(),r=t.defines,a=t.vertexShader,o=t.fragmentShader,l=xv(t),c=t.envMapPMREM===!0?"ENVMAP_TYPE_PMREM":"ENVMAP_TYPE_CUBE",h=vv(t),u=Mv(t),d=uv(t),f=dv(r),m=s.createProgram(),b,g,p=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(b=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,f].filter(ma).join(`
`),b.length>0&&(b+=`
`),g=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,f].filter(ma).join(`
`),g.length>0&&(g+=`
`)):(b=[op(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,f,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+h:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.diffuseRoughnessMap?"#define USE_DIFFUSE_ROUGHNESSMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.diffuseRoughnessMapUv?"#define DIFFUSE_ROUGHNESSMAP_UV "+t.diffuseRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexNormals?"#define HAS_NORMAL":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(ma).join(`
`),g=[op(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,f,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+c:"",t.envMap?"#define "+h:"",t.envMap?"#define "+u:"",t.envMapPMREM?"#define ENVMAP_MAX_LOD "+t.envMapMaxLod+".0":"",t.envMapPMREM?"#define ENVMAP_SIZE "+t.envMapSize+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.diffuseRoughness?"#define USE_DIFFUSE_ROUGHNESS":"",t.diffuseRoughnessMap?"#define USE_DIFFUSE_ROUGHNESSMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.retroreflection?"#define USE_RETROREFLECTION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor?"#define USE_COLOR":"",t.vertexAlphas||t.batchingColor?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==Zn?"#define TONE_MAPPING":"",t.toneMapping!==Zn?ze.tonemapping_pars_fragment:"",t.toneMapping!==Zn?cv("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",ze.colorspace_pars_fragment,ov("linearToOutputTexel",t.outputColorSpace),hv(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(ma).join(`
`)),a=zh(a),a=sp(a,t),a=rp(a,t),o=zh(o),o=sp(o,t),o=rp(o,t),a=ap(a),o=ap(o),t.isRawShaderMaterial!==!0&&(p=`#version 300 es
`,b=[d,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+b,g=["#define varying in",t.glslVersion===vh?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===vh?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+g);let x=p+b+a,w=p+g+o,y=tp(s,s.VERTEX_SHADER,x),S=tp(s,s.FRAGMENT_SHADER,w);s.attachShader(m,y),s.attachShader(m,S),t.index0AttributeName!==void 0?s.bindAttribLocation(m,0,t.index0AttributeName):t.hasPositionAttribute===!0&&s.bindAttribLocation(m,0,"position"),s.linkProgram(m);function E(R){if(i.debug.checkShaderErrors){let D=s.getProgramInfoLog(m)||"",B=s.getShaderInfoLog(y)||"",W=s.getShaderInfoLog(S)||"",I=D.trim(),G=B.trim(),j=W.trim(),z=!0,te=!0;if(s.getProgramParameter(m,s.LINK_STATUS)===!1)if(z=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(s,m,y,S);else{let q=ip(s,y,"vertex"),Z=ip(s,S,"fragment");Pe("WebGLProgram: Shader Error "+s.getError()+" - VALIDATE_STATUS "+s.getProgramParameter(m,s.VALIDATE_STATUS)+`

Material Name: `+R.name+`
Material Type: `+R.type+`

Program Info Log: `+I+`
`+q+`
`+Z)}else I!==""?Se("WebGLProgram: Program Info Log:",I):(G===""||j==="")&&(te=!1);te&&(R.diagnostics={runnable:z,programLog:I,vertexShader:{log:G,prefix:b},fragmentShader:{log:j,prefix:g}})}s.deleteShader(y),s.deleteShader(S),_=new dr(s,m),A=fv(s,m)}let _;this.getUniforms=function(){return _===void 0&&E(this),_};let A;this.getAttributes=function(){return A===void 0&&E(this),A};let k=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return k===!1&&(k=s.getProgramParameter(m,iv)),k},this.destroy=function(){n.releaseStatesOfProgram(this),s.deleteProgram(m),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=sv++,this.cacheKey=e,this.usedTimes=1,this.program=m,this.vertexShader=y,this.fragmentShader=S,this}function Ev(i){return i===Bi||i===ha||i===ua}function Tv(i,e,t,n,s,r){let a=new Br,o=new Gh,l=new Set,c=[],h=new Map,u=n.logarithmicDepthBuffer,d={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function f(_){return l.add(_),_===0?"uv":`uv${_}`}function m(_,A,k,R,D,B){let W=R.fog,I=D.geometry,G=_.isMeshStandardMaterial||_.isMeshLambertMaterial||_.isMeshPhongMaterial?R.environment:null,j=_.isMeshStandardMaterial||_.isMeshLambertMaterial&&!_.envMap||_.isMeshPhongMaterial&&!_.envMap,z=e.get(_.envMap||G,j),te=d[_.type],q=n.precision;_.precision!==null&&(q=n.getMaxPrecision(_.precision),q!==_.precision&&Se("WebGLProgram.getParameters:",_.precision,"not supported, using",q,"instead."));let Z=I.morphAttributes.position||I.morphAttributes.normal||I.morphAttributes.color,Q=Z!==void 0?Z.length:0,we=0;I.morphAttributes.position!==void 0&&(we=1),I.morphAttributes.normal!==void 0&&(we=2),I.morphAttributes.color!==void 0&&(we=3);let Fe,K,pe,xe;if(te){let de=ti[te];Fe=de.vertexShader,K=de.fragmentShader}else{Fe=_.vertexShader,K=_.fragmentShader;let de=o.getVertexShaderStage(_),Qe=o.getFragmentShaderStage(_);o.update(_,de,Qe),pe=de.id,xe=Qe.id}let Re=i.getRenderTarget(),me=i.state.buffers.depth.getReversed(),Oe=D.isInstancedMesh===!0,mt=D.isBatchedMesh===!0,Le=!!_.map,Ze=!!_.matcap,it=!!z,Xe=it&&z.isPMREMTexture===!0,Ft=!!_.aoMap,yt=!!_.lightMap,tn=!!_.bumpMap&&_.wireframe===!1,ht=!!_.normalMap,Vn=!!_.displacementMap,Tt=!!_.emissiveMap,_n=!!_.metalnessMap,bn=!!_.roughnessMap,xn=_.anisotropy>0,N=_.clearcoat>0,yn=_.diffuseRoughness>0,lt=_.dispersion>0,ct=_.retroreflectivity>0,ue=_.iridescence>0,vt=_.sheen>0,Ce=_.transmission>0,Ne=xn&&!!_.anisotropyMap,T=N&&!!_.clearcoatMap,v=N&&!!_.clearcoatNormalMap,U=N&&!!_.clearcoatRoughnessMap,ee=yn&&!!_.diffuseRoughnessMap,$=ue&&!!_.iridescenceMap,se=ue&&!!_.iridescenceThicknessMap,ce=vt&&!!_.sheenColorMap,X=vt&&!!_.sheenRoughnessMap,Y=!!_.specularMap,ae=!!_.specularColorMap,C=!!_.specularIntensityMap,J=Ce&&!!_.transmissionMap,V=Ce&&!!_.thicknessMap,oe=!!_.gradientMap,ie=!!_.alphaMap,re=_.alphaTest>0,Ae=!!_.alphaHash,He=!!_.extensions,ne=Zn;_.toneMapped&&(Re===null||Re.isXRRenderTarget===!0)&&(ne=i.toneMapping);let Te=Xe?z.isCompressedCubeTexture?z.image[0].mipmaps:z.mipmaps:null,Be={shaderID:te,shaderType:_.type,shaderName:_.name,vertexShader:Fe,fragmentShader:K,defines:_.defines,customVertexShaderID:pe,customFragmentShaderID:xe,isRawShaderMaterial:_.isRawShaderMaterial===!0,glslVersion:_.glslVersion,precision:q,batching:mt,batchingColor:mt&&D._colorsTexture!==null,instancing:Oe,instancingColor:Oe&&D.instanceColor!==null,instancingMorph:Oe&&D.morphTexture!==null,outputColorSpace:Re===null?i.outputColorSpace:Re.isXRRenderTarget===!0?Re.texture.colorSpace:Ge.workingColorSpace,alphaToCoverage:!!_.alphaToCoverage,map:Le,matcap:Ze,envMap:it,envMapMode:it&&z.mapping,envMapPMREM:Xe,envMapMaxLod:Xe?Te.length-1:null,envMapSize:Xe?Te[0].width:null,aoMap:Ft,lightMap:yt,bumpMap:tn,normalMap:ht,displacementMap:Vn,emissiveMap:Tt,normalMapObjectSpace:ht&&_.normalMapType===Tf,normalMapTangentSpace:ht&&_.normalMapType===vl,packedNormalMap:ht&&_.normalMapType===vl&&Ev(_.normalMap.format),metalnessMap:_n,roughnessMap:bn,anisotropy:xn,anisotropyMap:Ne,clearcoat:N,clearcoatMap:T,clearcoatNormalMap:v,clearcoatRoughnessMap:U,diffuseRoughness:yn,diffuseRoughnessMap:ee,dispersion:lt,retroreflection:ct,iridescence:ue,iridescenceMap:$,iridescenceThicknessMap:se,sheen:vt,sheenColorMap:ce,sheenRoughnessMap:X,specularMap:Y,specularColorMap:ae,specularIntensityMap:C,transmission:Ce,transmissionMap:J,thicknessMap:V,gradientMap:oe,opaque:_.transparent===!1&&_.blending===or&&_.alphaToCoverage===!1,alphaMap:ie,alphaTest:re,alphaHash:Ae,combine:_.combine,mapUv:Le&&f(_.map.channel),aoMapUv:Ft&&f(_.aoMap.channel),lightMapUv:yt&&f(_.lightMap.channel),bumpMapUv:tn&&f(_.bumpMap.channel),normalMapUv:ht&&f(_.normalMap.channel),displacementMapUv:Vn&&f(_.displacementMap.channel),emissiveMapUv:Tt&&f(_.emissiveMap.channel),metalnessMapUv:_n&&f(_.metalnessMap.channel),roughnessMapUv:bn&&f(_.roughnessMap.channel),anisotropyMapUv:Ne&&f(_.anisotropyMap.channel),clearcoatMapUv:T&&f(_.clearcoatMap.channel),clearcoatNormalMapUv:v&&f(_.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:U&&f(_.clearcoatRoughnessMap.channel),diffuseRoughnessMapUv:ee&&f(_.diffuseRoughnessMap.channel),iridescenceMapUv:$&&f(_.iridescenceMap.channel),iridescenceThicknessMapUv:se&&f(_.iridescenceThicknessMap.channel),sheenColorMapUv:ce&&f(_.sheenColorMap.channel),sheenRoughnessMapUv:X&&f(_.sheenRoughnessMap.channel),specularMapUv:Y&&f(_.specularMap.channel),specularColorMapUv:ae&&f(_.specularColorMap.channel),specularIntensityMapUv:C&&f(_.specularIntensityMap.channel),transmissionMapUv:J&&f(_.transmissionMap.channel),thicknessMapUv:V&&f(_.thicknessMap.channel),alphaMapUv:ie&&f(_.alphaMap.channel),vertexTangents:!!I.attributes.tangent&&(ht||xn),vertexNormals:!!I.attributes.normal,vertexColors:_.vertexColors,vertexAlphas:_.vertexColors===!0&&!!I.attributes.color&&I.attributes.color.itemSize===4,pointsUvs:D.isPoints===!0&&!!I.attributes.uv&&(Le||ie),fog:!!W,useFog:_.fog===!0,fogExp2:!!W&&W.isFogExp2,flatShading:_.wireframe===!1&&(_.flatShading===!0||I.attributes.normal===void 0&&ht===!1&&(_.isMeshLambertMaterial||_.isMeshPhongMaterial||_.isMeshStandardMaterial||_.isMeshPhysicalMaterial)),sizeAttenuation:_.sizeAttenuation===!0,logarithmicDepthBuffer:u,reversedDepthBuffer:me,skinning:D.isSkinnedMesh===!0,hasPositionAttribute:I.attributes.position!==void 0,morphTargets:I.morphAttributes.position!==void 0,morphNormals:I.morphAttributes.normal!==void 0,morphColors:I.morphAttributes.color!==void 0,morphTargetsCount:Q,morphTextureStride:we,numSunLights:A.sun.length,numDirLights:A.directional.length,numPointLights:A.point.length,numSpotLights:A.spot.length,numSpotLightMaps:A.spotLightMap.length,numRectAreaLights:A.rectArea.length,numHemiLights:A.hemi.length,numSunLightShadows:A.sunShadowMap.length,numDirLightShadows:A.directionalShadowMap.length,numPointLightShadows:A.pointShadowMap.length,numSpotLightShadows:A.spotShadowMap.length,numSpotLightShadowsWithMaps:A.numSpotLightShadowsWithMaps,numLightProbes:A.numLightProbes,numLightProbeGrids:B.filter(de=>de.texture!==null).length,numClippingPlanes:r.numPlanes,numClipIntersection:r.numIntersection,dithering:_.dithering,shadowMapEnabled:i.shadowMap.enabled&&k.length>0,shadowMapType:i.shadowMap.type,toneMapping:ne,decodeVideoTexture:Le&&_.map.isVideoTexture===!0&&Ge.getTransfer(_.map.colorSpace)===$e,decodeVideoTextureEmissive:Tt&&_.emissiveMap.isVideoTexture===!0&&Ge.getTransfer(_.emissiveMap.colorSpace)===$e,premultipliedAlpha:_.premultipliedAlpha,doubleSided:_.side===on,flipSided:_.side===en,useDepthPacking:_.depthPacking>=0,depthPacking:_.depthPacking||0,index0AttributeName:_.index0AttributeName,extensionClipCullDistance:He&&_.extensions.clipCullDistance===!0&&t.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(He&&_.extensions.multiDraw===!0||mt)&&t.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:t.has("KHR_parallel_shader_compile"),customProgramCacheKey:_.customProgramCacheKey()};return Be.vertexUv1s=l.has(1),Be.vertexUv2s=l.has(2),Be.vertexUv3s=l.has(3),l.clear(),Be}function b(_){let A=[];if(_.shaderID?A.push(_.shaderID):(A.push(_.customVertexShaderID),A.push(_.customFragmentShaderID)),_.defines!==void 0)for(let k in _.defines)A.push(k),A.push(_.defines[k]);return _.isRawShaderMaterial===!1&&(g(A,_),p(A,_),A.push(i.outputColorSpace)),A.push(_.customProgramCacheKey),A.join()}function g(_,A){_.push(A.precision),_.push(A.outputColorSpace),_.push(A.envMapMode),_.push(A.envMapPMREM),_.push(A.envMapMaxLod),_.push(A.envMapSize),_.push(A.mapUv),_.push(A.alphaMapUv),_.push(A.lightMapUv),_.push(A.aoMapUv),_.push(A.bumpMapUv),_.push(A.normalMapUv),_.push(A.displacementMapUv),_.push(A.emissiveMapUv),_.push(A.metalnessMapUv),_.push(A.roughnessMapUv),_.push(A.anisotropyMapUv),_.push(A.clearcoatMapUv),_.push(A.clearcoatNormalMapUv),_.push(A.clearcoatRoughnessMapUv),_.push(A.diffuseRoughnessMapUv),_.push(A.iridescenceMapUv),_.push(A.iridescenceThicknessMapUv),_.push(A.sheenColorMapUv),_.push(A.sheenRoughnessMapUv),_.push(A.specularMapUv),_.push(A.specularColorMapUv),_.push(A.specularIntensityMapUv),_.push(A.transmissionMapUv),_.push(A.thicknessMapUv),_.push(A.combine),_.push(A.fogExp2),_.push(A.sizeAttenuation),_.push(A.morphTargetsCount),_.push(A.numSunLights),_.push(A.numDirLights),_.push(A.numPointLights),_.push(A.numSpotLights),_.push(A.numSpotLightMaps),_.push(A.numHemiLights),_.push(A.numRectAreaLights),_.push(A.numSunLightShadows),_.push(A.numDirLightShadows),_.push(A.numPointLightShadows),_.push(A.numSpotLightShadows),_.push(A.numSpotLightShadowsWithMaps),_.push(A.numLightProbes),_.push(A.numLightProbeGrids),_.push(A.shadowMapType),_.push(A.toneMapping),_.push(A.numClippingPlanes),_.push(A.numClipIntersection),_.push(A.depthPacking)}function p(_,A){a.disableAll(),A.instancing&&a.enable(0),A.instancingColor&&a.enable(1),A.instancingMorph&&a.enable(2),A.matcap&&a.enable(3),A.envMap&&a.enable(4),A.normalMapObjectSpace&&a.enable(5),A.normalMapTangentSpace&&a.enable(6),A.clearcoat&&a.enable(7),A.iridescence&&a.enable(8),A.alphaTest&&a.enable(9),A.vertexColors&&a.enable(10),A.vertexAlphas&&a.enable(11),A.vertexUv1s&&a.enable(12),A.vertexUv2s&&a.enable(13),A.vertexUv3s&&a.enable(14),A.vertexTangents&&a.enable(15),A.anisotropy&&a.enable(16),A.alphaHash&&a.enable(17),A.batching&&a.enable(18),A.dispersion&&a.enable(19),A.retroreflection&&a.enable(24),A.diffuseRoughness&&a.enable(25),A.batchingColor&&a.enable(20),A.gradientMap&&a.enable(21),A.packedNormalMap&&a.enable(22),A.vertexNormals&&a.enable(23),_.push(a.mask),a.disableAll(),A.fog&&a.enable(0),A.useFog&&a.enable(1),A.flatShading&&a.enable(2),A.logarithmicDepthBuffer&&a.enable(3),A.reversedDepthBuffer&&a.enable(4),A.skinning&&a.enable(5),A.morphTargets&&a.enable(6),A.morphNormals&&a.enable(7),A.morphColors&&a.enable(8),A.premultipliedAlpha&&a.enable(9),A.shadowMapEnabled&&a.enable(10),A.doubleSided&&a.enable(11),A.flipSided&&a.enable(12),A.useDepthPacking&&a.enable(13),A.dithering&&a.enable(14),A.transmission&&a.enable(15),A.sheen&&a.enable(16),A.opaque&&a.enable(17),A.pointsUvs&&a.enable(18),A.decodeVideoTexture&&a.enable(19),A.decodeVideoTextureEmissive&&a.enable(20),A.alphaToCoverage&&a.enable(21),A.numLightProbeGrids>0&&a.enable(22),A.hasPositionAttribute&&a.enable(23),_.push(a.mask)}function x(_){let A=d[_.type],k;if(A){let R=ti[A];k=Hf.clone(R.uniforms)}else k=_.uniforms;return k}function w(_,A){let k=h.get(A);return k!==void 0?++k.usedTimes:(k=new Sv(i,A,_,s),c.push(k),h.set(A,k)),k}function y(_){if(--_.usedTimes===0){let A=c.indexOf(_);c[A]=c[c.length-1],c.pop(),h.delete(_.cacheKey),_.destroy()}}function S(_){o.remove(_)}function E(){o.dispose()}return{getParameters:m,getProgramCacheKey:b,getUniforms:x,acquireProgram:w,releaseProgram:y,releaseShaderCache:S,programs:c,dispose:E}}function Rv(){let i=new WeakMap;function e(a){return i.has(a)}function t(a){let o=i.get(a);return o===void 0&&(o={},i.set(a,o)),o}function n(a){i.delete(a)}function s(a,o,l){i.get(a)[o]=l}function r(){i=new WeakMap}return{has:e,get:t,remove:n,update:s,dispose:r}}function Cv(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.material.id!==e.material.id?i.material.id-e.material.id:i.materialVariant!==e.materialVariant?i.materialVariant-e.materialVariant:i.z!==e.z?i.z-e.z:i.id-e.id}function lp(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.z!==e.z?e.z-i.z:i.id-e.id}function cp(){let i=[],e=0,t=[],n=[],s=[];function r(){e=0,t.length=0,n.length=0,s.length=0}function a(d){let f=0;return d.isInstancedMesh&&(f+=2),d.isSkinnedMesh&&(f+=1),f}function o(d,f,m,b,g,p){let x=i[e];return x===void 0?(x={id:d.id,object:d,geometry:f,material:m,materialVariant:a(d),groupOrder:b,renderOrder:d.renderOrder,z:g,group:p},i[e]=x):(x.id=d.id,x.object=d,x.geometry=f,x.material=m,x.materialVariant=a(d),x.groupOrder=b,x.renderOrder=d.renderOrder,x.z=g,x.group=p),e++,x}function l(d,f,m,b,g,p,x){x.reversedDepth===!0&&(g=-g);let w=o(d,f,m,b,g,p);m.transmission>0?n.push(w):m.transparent===!0?s.push(w):t.push(w)}function c(d,f,m,b,g,p){let x=o(d,f,m,b,g,p);m.transmission>0?n.unshift(x):m.transparent===!0?s.unshift(x):t.unshift(x)}function h(d,f){t.length>1&&t.sort(d||Cv),n.length>1&&n.sort(f||lp),s.length>1&&s.sort(f||lp)}function u(){for(let d=e,f=i.length;d<f;d++){let m=i[d];if(m.id===null)break;m.id=null,m.object=null,m.geometry=null,m.material=null,m.group=null}}return{opaque:t,transmissive:n,transparent:s,init:r,push:l,unshift:c,finish:u,sort:h}}function Lv(){let i=new WeakMap;function e(n,s){let r=i.get(n),a;return r===void 0?(a=new cp,i.set(n,[a])):s>=r.length?(a=new cp,r.push(a)):a=r[s],a}function t(){i=new WeakMap}return{get:e,dispose:t}}function Pv(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"SunLight":case"DirectionalLight":t={direction:new L,color:new Ee};break;case"SpotLight":t={position:new L,direction:new L,color:new Ee,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new L,color:new Ee,distance:0,decay:0};break;case"HemisphereLight":t={direction:new L,skyColor:new Ee,groundColor:new Ee};break;case"RectAreaLight":t={color:new Ee,position:new L,halfWidth:new L,halfHeight:new L};break}return i[e.id]=t,t}}}function Iv(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"SunLight":case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ie};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ie};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ie,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[e.id]=t,t}}}function Dv(i,e){return(e.castShadow?2:0)-(i.castShadow?2:0)+(e.map?1:0)-(i.map?1:0)}function Nv(i){let e=new Pv,t=Iv(),n={version:0,hash:{sunLength:-1,directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numSunShadows:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],sun:[],sunShadow:[],sunShadowMap:[],sunShadowMatrix:[],sunShadowCascade:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)n.probe.push(new L);let s=new L,r=new ke,a=new ke;function o(c){let h=0,u=0,d=0;for(let B=0;B<9;B++)n.probe[B].set(0,0,0);let f=0,m=0,b=0,g=0,p=0,x=0,w=0,y=0,S=0,E=0,_=0,A=0,k=0,R=0;c.sort(Dv);for(let B=0,W=c.length;B<W;B++){let I=c[B],G=I.color,j=I.intensity,z=I.distance,te=null;if(I.shadow&&I.shadow.map&&(I.shadow.map.texture.format===Bi?te=I.shadow.map.texture:te=I.shadow.map.depthTexture||I.shadow.map.texture),I.isAmbientLight)h+=G.r*j,u+=G.g*j,d+=G.b*j;else if(I.isLightProbe){for(let q=0;q<9;q++)n.probe[q].addScaledVector(I.sh.coefficients[q],j);R++}else if(I.isSunLight){let q=e.get(I);if(q.color.copy(I.color).multiplyScalar(I.intensity),I.castShadow){let Z=I.shadow,Q=t.get(I);Q.shadowIntensity=Z.intensity,Q.shadowBias=Z.bias,Q.shadowNormalBias=Z.normalBias,Q.shadowRadius=Z.radius,Q.shadowMapSize.copy(Z.mapSize).multiply(Z.getFrameExtents()),n.sunShadow[m]=Q,n.sunShadowMap[m]=te;let we=Z.getViewportCount();for(let Fe=0;Fe<we;Fe++)n.sunShadowMatrix[b+Fe]=Z.getMatrix(Fe),n.sunShadowCascade[b+Fe]=Z._cascadeData[Fe];b+=we,m++}n.sun[f]=q,f++}else if(I.isDirectionalLight){let q=e.get(I);if(q.color.copy(I.color).multiplyScalar(I.intensity),I.castShadow){let Z=I.shadow,Q=t.get(I);Q.shadowIntensity=Z.intensity,Q.shadowBias=Z.bias,Q.shadowNormalBias=Z.normalBias,Q.shadowRadius=Z.radius,Q.shadowMapSize=Z.mapSize,n.directionalShadow[g]=Q,n.directionalShadowMap[g]=te,n.directionalShadowMatrix[g]=I.shadow.matrix,S++}n.directional[g]=q,g++}else if(I.isSpotLight){let q=e.get(I);q.position.setFromMatrixPosition(I.matrixWorld),q.color.copy(G).multiplyScalar(j),q.distance=z,q.coneCos=Math.cos(I.angle),q.penumbraCos=Math.cos(I.angle*(1-I.penumbra)),q.decay=I.decay,n.spot[x]=q;let Z=I.shadow;if(I.map&&(n.spotLightMap[A]=I.map,A++,Z.updateMatrices(I),I.castShadow&&k++),n.spotLightMatrix[x]=Z.matrix,I.castShadow){let Q=t.get(I);Q.shadowIntensity=Z.intensity,Q.shadowBias=Z.bias,Q.shadowNormalBias=Z.normalBias,Q.shadowRadius=Z.radius,Q.shadowMapSize=Z.mapSize,n.spotShadow[x]=Q,n.spotShadowMap[x]=te,_++}x++}else if(I.isRectAreaLight){let q=e.get(I);q.color.copy(G).multiplyScalar(j),q.halfWidth.set(I.width*.5,0,0),q.halfHeight.set(0,I.height*.5,0),n.rectArea[w]=q,w++}else if(I.isPointLight){let q=e.get(I);if(q.color.copy(I.color).multiplyScalar(I.intensity),q.distance=I.distance,q.decay=I.decay,I.castShadow){let Z=I.shadow,Q=t.get(I);Q.shadowIntensity=Z.intensity,Q.shadowBias=Z.bias,Q.shadowNormalBias=Z.normalBias,Q.shadowRadius=Z.radius,Q.shadowMapSize=Z.mapSize,Q.shadowCameraNear=Z.camera.near,Q.shadowCameraFar=Z.camera.far,n.pointShadow[p]=Q,n.pointShadowMap[p]=te,n.pointShadowMatrix[p]=I.shadow.matrix,E++}n.point[p]=q,p++}else if(I.isHemisphereLight){let q=e.get(I);q.skyColor.copy(I.color).multiplyScalar(j),q.groundColor.copy(I.groundColor).multiplyScalar(j),n.hemi[y]=q,y++}}w>0&&(i.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=fe.LTC_FLOAT_1,n.rectAreaLTC2=fe.LTC_FLOAT_2):(n.rectAreaLTC1=fe.LTC_HALF_1,n.rectAreaLTC2=fe.LTC_HALF_2)),n.ambient[0]=h,n.ambient[1]=u,n.ambient[2]=d;let D=n.hash;(D.sunLength!==f||D.directionalLength!==g||D.pointLength!==p||D.spotLength!==x||D.rectAreaLength!==w||D.hemiLength!==y||D.numSunShadows!==m||D.numDirectionalShadows!==S||D.numPointShadows!==E||D.numSpotShadows!==_||D.numSpotMaps!==A||D.numLightProbes!==R)&&(n.sun.length=f,n.directional.length=g,n.spot.length=x,n.rectArea.length=w,n.point.length=p,n.hemi.length=y,n.sunShadow.length=m,n.sunShadowMap.length=m,n.sunShadowMatrix.length=b,n.sunShadowCascade.length=b,n.directionalShadow.length=S,n.directionalShadowMap.length=S,n.directionalShadowMatrix.length=S,n.pointShadow.length=E,n.pointShadowMap.length=E,n.pointShadowMatrix.length=E,n.spotShadow.length=_,n.spotShadowMap.length=_,n.spotLightMatrix.length=_+A-k,n.spotLightMap.length=A,n.numSpotLightShadowsWithMaps=k,n.numLightProbes=R,D.sunLength=f,D.directionalLength=g,D.pointLength=p,D.spotLength=x,D.rectAreaLength=w,D.hemiLength=y,D.numSunShadows=m,D.numDirectionalShadows=S,D.numPointShadows=E,D.numSpotShadows=_,D.numSpotMaps=A,D.numLightProbes=R,n.version=kv++)}function l(c,h){let u=0,d=0,f=0,m=0,b=0,g=0,p=h.matrixWorldInverse;for(let x=0,w=c.length;x<w;x++){let y=c[x];if(y.isSunLight){let S=n.sun[u];S.direction.setFromMatrixPosition(y.matrixWorld),S.direction.transformDirection(p),u++}else if(y.isDirectionalLight){let S=n.directional[d];S.direction.setFromMatrixPosition(y.matrixWorld),s.setFromMatrixPosition(y.target.matrixWorld),S.direction.sub(s),S.direction.transformDirection(p),d++}else if(y.isSpotLight){let S=n.spot[m];S.position.setFromMatrixPosition(y.matrixWorld),S.position.applyMatrix4(p),S.direction.setFromMatrixPosition(y.matrixWorld),s.setFromMatrixPosition(y.target.matrixWorld),S.direction.sub(s),S.direction.transformDirection(p),m++}else if(y.isRectAreaLight){let S=n.rectArea[b];S.position.setFromMatrixPosition(y.matrixWorld),S.position.applyMatrix4(p),a.identity(),r.copy(y.matrixWorld),r.premultiply(p),a.extractRotation(r),S.halfWidth.set(y.width*.5,0,0),S.halfHeight.set(0,y.height*.5,0),S.halfWidth.applyMatrix4(a),S.halfHeight.applyMatrix4(a),b++}else if(y.isPointLight){let S=n.point[f];S.position.setFromMatrixPosition(y.matrixWorld),S.position.applyMatrix4(p),f++}else if(y.isHemisphereLight){let S=n.hemi[g];S.direction.setFromMatrixPosition(y.matrixWorld),S.direction.transformDirection(p),g++}}}return{setup:o,setupView:l,state:n}}function hp(i){let e=new Nv(i),t=[],n=[],s=[];function r(u){h.camera=u,t.length=0,n.length=0,s.length=0}function a(u){u.isLightProbeGrid?s.push(u):t.push(u)}function o(u){n.push(u)}function l(){e.setup(t),s.sort((u,d)=>u.priority-d.priority||u.id-d.id)}function c(u){e.setupView(t,u)}let h={lightsArray:t,shadowsArray:n,lightProbeGridArray:s,camera:null,lights:e,transmissionRenderTarget:{},textureUnits:0};return{init:r,state:h,setupLights:l,setupLightsView:c,pushLight:a,pushShadow:o}}function Fv(i){let e=new WeakMap;function t(s,r=0){let a=e.get(s),o;return a===void 0?(o=new hp(i),e.set(s,[o])):r>=a.length?(o=new hp(i),a.push(o)):o=a[r],o}function n(){e=new WeakMap}return{get:t,dispose:n}}function zv(i,e,t){let n=new ki,s=new Ie,r=new Ie,a=new et,o=new wo,l=new Mo,c={},h=t.maxTextureSize,u={[$n]:en,[en]:$n,[on]:on},d=new Xn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Ie},radius:{value:4}},vertexShader:Uv,fragmentShader:Ov}),f=d.clone();f.defines.HORIZONTAL_PASS=1;let m=new $t;m.setAttribute("position",new Ot(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let b=new Bt(m,d),g=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=ra;let p=this.type;this.render=function(E,_,A){if(g.enabled===!1||g.autoUpdate===!1&&g.needsUpdate===!1||E.length===0)return;this.type===nf&&(Se("WebGLShadowMap: PCFSoftShadowMap has been removed. Using PCFShadowMap instead."),this.type=ra);let k=i.getRenderTarget(),R=i.getActiveCubeFace(),D=i.getActiveMipmapLevel(),B=i.state;B.setBlending(cs),B.buffers.depth.getReversed()===!0?B.buffers.color.setClear(0,0,0,0):B.buffers.color.setClear(1,1,1,1),B.buffers.depth.setTest(!0),B.setScissorTest(!1);let W=p!==this.type;W&&_.traverse(function(I){I.material&&(Array.isArray(I.material)?I.material.forEach(G=>G.needsUpdate=!0):I.material.needsUpdate=!0)});for(let I=0,G=E.length;I<G;I++){let j=E[I],z=j.shadow;if(z===void 0){Se("WebGLShadowMap:",j,"has no shadow.");continue}if(z.autoUpdate===!1&&z.needsUpdate===!1)continue;s.copy(z.mapSize);let te=z.getFrameExtents();s.multiply(te),r.copy(z.mapSize),(s.x>h||s.y>h)&&(s.x>h&&(r.x=Math.floor(h/te.x),s.x=r.x*te.x,z.mapSize.x=r.x),s.y>h&&(r.y=Math.floor(h/te.y),s.y=r.y*te.y,z.mapSize.y=r.y));let q=i.state.buffers.depth.getReversed();if(z.camera._reversedDepth=q,z.map===null||W===!0){if(z.map!==null&&(z.map.depthTexture!==null&&(z.map.depthTexture.dispose(),z.map.depthTexture=null),z.map.dispose()),this.type===ar){if(j.isPointLight){Se("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}z.map=new dn(s.x,s.y,{format:Bi,type:Hn,minFilter:St,magFilter:St,generateMipmaps:!1}),z.map.texture.name=j.name+".shadowMap",z.map.depthTexture=new mi(s.x,s.y,fn),z.map.depthTexture.name=j.name+".shadowMapDepth",z.map.depthTexture.format=fi,z.map.depthTexture.compareFunction=null,z.map.depthTexture.minFilter=pt,z.map.depthTexture.magFilter=pt}else j.isPointLight?(z.map=new ga(s.x),z.map.depthTexture=new jr(s.x,Bn)):(z.map=new dn(s.x,s.y),z.map.depthTexture=new mi(s.x,s.y,Bn)),z.map.depthTexture.name=j.name+".shadowMap",z.map.depthTexture.format=fi,this.type===ra?(z.map.depthTexture.compareFunction=q?bh:_h,z.map.depthTexture.minFilter=St,z.map.depthTexture.magFilter=St):(z.map.depthTexture.compareFunction=null,z.map.depthTexture.minFilter=pt,z.map.depthTexture.magFilter=pt);z.camera.updateProjectionMatrix()}z.map.isWebGLCubeRenderTarget!==!0&&(z.map.width!==s.x||z.map.height!==s.y)&&z.map.setSize(s.x,s.y);let Z=z.map.isWebGLCubeRenderTarget?6:z.getViewportCount();j.isPointLight!==!0&&z.updateMatrices(j,A);let Q=(z.camera.layers.mask&4294967294)!==0?z.camera.layers:A.layers;for(let we=0;we<Z;we++){let Fe=z.getCamera(we);if(j.isPointLight){let K=z.camera,pe=z.matrix,xe=j.distance||K.far;xe!==K.far&&(K.far=xe,K.updateProjectionMatrix()),pa.setFromMatrixPosition(j.matrixWorld),K.position.copy(pa),Uh.copy(K.position),Uh.add(Bv[we]),K.up.copy(Hv[we]),K.lookAt(Uh),K.updateMatrixWorld(),pe.makeTranslation(-pa.x,-pa.y,-pa.z),up.multiplyMatrices(K.projectionMatrix,K.matrixWorldInverse),z._frustum.setFromProjectionMatrix(up,K.coordinateSystem,K.reversedDepth)}if(z.map.isWebGLCubeRenderTarget)i.setRenderTarget(z.map,we),i.clear();else{we===0&&(i.setRenderTarget(z.map),i.clear());let K=z.getViewport(we);a.set(r.x*K.x,r.y*K.y,r.x*K.z,r.y*K.w),B.viewport(a)}n=z.getFrustum(we),y(_,A,Fe,j,Q,this.type)}z.isPointLightShadow!==!0&&this.type===ar&&x(z,A),z.needsUpdate=!1}p=this.type,g.needsUpdate=!1,i.setRenderTarget(k,R,D)};function x(E,_){let A=e.update(b);d.defines.VSM_SAMPLES!==E.blurSamples&&(d.defines.VSM_SAMPLES=E.blurSamples,f.defines.VSM_SAMPLES=E.blurSamples,d.needsUpdate=!0,f.needsUpdate=!0),E.mapPass===null?E.mapPass=new dn(s.x,s.y,{format:Bi,type:Hn}):(E.mapPass.width!==E.map.width||E.mapPass.height!==E.map.height)&&E.mapPass.setSize(E.map.width,E.map.height),d.uniforms.shadow_pass.value=E.map.depthTexture,d.uniforms.resolution.value.set(E.map.width,E.map.height),d.uniforms.radius.value=E.radius,i.setRenderTarget(E.mapPass),i.clear(),i.renderBufferDirect(_,null,A,d,b,null),f.uniforms.shadow_pass.value=E.mapPass.texture,f.uniforms.resolution.value.set(E.map.width,E.map.height),f.uniforms.radius.value=E.radius,i.setRenderTarget(E.map),i.clear(),i.renderBufferDirect(_,null,A,f,b,null)}function w(E,_,A,k){let R=null,D=A.isPointLight===!0?E.customDistanceMaterial:E.customDepthMaterial;if(D!==void 0)R=D;else if(R=A.isPointLight===!0?l:o,i.localClippingEnabled&&_.clipShadows===!0&&Array.isArray(_.clippingPlanes)&&_.clippingPlanes.length!==0||_.displacementMap&&_.displacementScale!==0||_.alphaMap&&_.alphaTest>0||_.map&&_.alphaTest>0||_.alphaToCoverage===!0){let B=R.uuid,W=_.uuid,I=c[B];I===void 0&&(I={},c[B]=I);let G=I[W];G===void 0&&(G=R.clone(),I[W]=G,_.addEventListener("dispose",S)),R=G}if(R.visible=_.visible,R.wireframe=_.wireframe,k===ar?R.side=_.shadowSide!==null?_.shadowSide:_.side:R.side=_.shadowSide!==null?_.shadowSide:u[_.side],R.alphaMap=_.alphaMap,R.alphaTest=_.alphaToCoverage===!0?.5:_.alphaTest,R.map=_.map,R.clipShadows=_.clipShadows,R.clippingPlanes=_.clippingPlanes,R.clipIntersection=_.clipIntersection,R.displacementMap=_.displacementMap,R.displacementScale=_.displacementScale,R.displacementBias=_.displacementBias,R.wireframeLinewidth=_.wireframeLinewidth,R.linewidth=_.linewidth,A.isPointLight===!0&&R.isMeshDistanceMaterial===!0){let B=i.properties.get(R);B.light=A}return R}function y(E,_,A,k,R,D){if(E.visible===!1)return;if(E.layers.test(R)&&(E.isMesh||E.isLine||E.isPoints)&&(E.castShadow||E.receiveShadow&&D===ar)&&(!E.frustumCulled||E.intersectsFrustum(n))){E.modelViewMatrix.multiplyMatrices(A.matrixWorldInverse,E.matrixWorld);let I=e.update(E),G=E.material;if(Array.isArray(G)){let j=I.groups;for(let z=0,te=j.length;z<te;z++){let q=j[z],Z=G[q.materialIndex];if(Z&&Z.visible){let Q=w(E,Z,k,D);E.onBeforeShadow(i,E,_,A,I,Q,q),i.renderBufferDirect(A,null,I,Q,E,q),E.onAfterShadow(i,E,_,A,I,Q,q)}}}else if(G.visible){let j=w(E,G,k,D);E.onBeforeShadow(i,E,_,A,I,j,null),i.renderBufferDirect(A,null,I,j,E,null),E.onAfterShadow(i,E,_,A,I,j,null)}}let W=E.children;for(let I=0,G=W.length;I<G;I++)y(W[I],_,A,k,R,D)}function S(E){E.target.removeEventListener("dispose",S);for(let A in c){let k=c[A],R=E.target.uuid;R in k&&(k[R].dispose(),delete k[R])}}}function Gv(i,e){function t(){let C=!1,J=new et,V=null,oe=new et(0,0,0,0);return{setMask:function(ie){V!==ie&&!C&&(i.colorMask(ie,ie,ie,ie),V=ie)},setLocked:function(ie){C=ie},setClear:function(ie,re,Ae,He,ne){ne===!0&&(ie*=He,re*=He,Ae*=He),J.set(ie,re,Ae,He),oe.equals(J)===!1&&(i.clearColor(ie,re,Ae,He),oe.copy(J))},reset:function(){C=!1,V=null,oe.set(-1,0,0,0)}}}function n(){let C=!1,J=!1,V=null,oe=null,ie=null;return{setReversed:function(re){if(J!==re){let Ae=e.get("EXT_clip_control");re?Ae.clipControlEXT(Ae.LOWER_LEFT_EXT,Ae.ZERO_TO_ONE_EXT):Ae.clipControlEXT(Ae.LOWER_LEFT_EXT,Ae.NEGATIVE_ONE_TO_ONE_EXT),J=re;let He=ie;ie=null,this.setClear(He)}},getReversed:function(){return J},setTest:function(re){re?me(i.DEPTH_TEST):Oe(i.DEPTH_TEST)},setMask:function(re){V!==re&&!C&&(i.depthMask(re),V=re)},setFunc:function(re){if(J&&(re=Of[re]),oe!==re){switch(re){case oo:i.depthFunc(i.NEVER);break;case lo:i.depthFunc(i.ALWAYS);break;case co:i.depthFunc(i.LESS);break;case Gs:i.depthFunc(i.LEQUAL);break;case ho:i.depthFunc(i.EQUAL);break;case uo:i.depthFunc(i.GEQUAL);break;case fo:i.depthFunc(i.GREATER);break;case po:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}oe=re}},setLocked:function(re){C=re},setClear:function(re){ie!==re&&(ie=re,J&&(re=1-re),i.clearDepth(re))},reset:function(){C=!1,V=null,oe=null,ie=null,J=!1}}}function s(){let C=!1,J=null,V=null,oe=null,ie=null,re=null,Ae=null,He=null,ne=null;return{setTest:function(Te){C||(Te?me(i.STENCIL_TEST):Oe(i.STENCIL_TEST))},setMask:function(Te){J!==Te&&!C&&(i.stencilMask(Te),J=Te)},setFunc:function(Te,Be,de){(V!==Te||oe!==Be||ie!==de)&&(i.stencilFunc(Te,Be,de),V=Te,oe=Be,ie=de)},setOp:function(Te,Be,de){(re!==Te||Ae!==Be||He!==de)&&(i.stencilOp(Te,Be,de),re=Te,Ae=Be,He=de)},setLocked:function(Te){C=Te},setClear:function(Te){ne!==Te&&(i.clearStencil(Te),ne=Te)},reset:function(){C=!1,J=null,V=null,oe=null,ie=null,re=null,Ae=null,He=null,ne=null}}}let r=new t,a=new n,o=new s,l={},c=new WeakMap,h={},u={},d={},f=new WeakMap,m=[],b=null,g=!1,p=null,x=null,w=null,y=null,S=null,E=null,_=null,A=new Ee(0,0,0),k=0,R=!1,D=null,B=null,W=null,I=null,G=null,j=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS),z=!1,te=0,q=i.getParameter(i.VERSION);q.indexOf("WebGL")!==-1?(te=parseFloat(/^WebGL (\d)/.exec(q)[1]),z=te>=1):q.indexOf("OpenGL ES")!==-1&&(te=parseFloat(/^OpenGL ES (\d)/.exec(q)[1]),z=te>=2);let Z=null,Q={},we=i.getParameter(i.SCISSOR_BOX),Fe=i.getParameter(i.VIEWPORT),K=new et().fromArray(we),pe=new et().fromArray(Fe);function xe(C,J,V,oe){let ie=new Uint8Array(4),re=i.createTexture();i.bindTexture(C,re),i.texParameteri(C,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(C,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let Ae=0;Ae<V;Ae++)C===i.TEXTURE_3D||C===i.TEXTURE_2D_ARRAY?i.texImage3D(J,0,i.RGBA,1,1,oe,0,i.RGBA,i.UNSIGNED_BYTE,ie):i.texImage2D(J+Ae,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,ie);return re}let Re={};Re[i.TEXTURE_2D]=xe(i.TEXTURE_2D,i.TEXTURE_2D,1),Re[i.TEXTURE_CUBE_MAP]=xe(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),Re[i.TEXTURE_2D_ARRAY]=xe(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),Re[i.TEXTURE_3D]=xe(i.TEXTURE_3D,i.TEXTURE_3D,1,1),r.setClear(0,0,0,1),a.setClear(1),o.setClear(0),me(i.DEPTH_TEST),a.setFunc(Gs),tn(!1),ht(Kc),me(i.CULL_FACE),Ft(cs);function me(C){h[C]!==!0&&(i.enable(C),h[C]=!0)}function Oe(C){h[C]!==!1&&(i.disable(C),h[C]=!1)}function mt(C,J){return d[C]!==J?(i.bindFramebuffer(C,J),d[C]=J,C===i.DRAW_FRAMEBUFFER&&(d[i.FRAMEBUFFER]=J),C===i.FRAMEBUFFER&&(d[i.DRAW_FRAMEBUFFER]=J),!0):!1}function Le(C,J){let V=m,oe=!1;if(C){V=f.get(J),V===void 0&&(V=[],f.set(J,V));let ie=C.textures;if(V.length!==ie.length||V[0]!==i.COLOR_ATTACHMENT0){for(let re=0,Ae=ie.length;re<Ae;re++)V[re]=i.COLOR_ATTACHMENT0+re;V.length=ie.length,oe=!0}}else V[0]!==i.BACK&&(V[0]=i.BACK,oe=!0);oe&&i.drawBuffers(V)}function Ze(C){return b!==C?(i.useProgram(C),b=C,!0):!1}let it={[hs]:i.FUNC_ADD,[rf]:i.FUNC_SUBTRACT,[af]:i.FUNC_REVERSE_SUBTRACT};it[of]=i.MIN,it[lf]=i.MAX;let Xe={[cf]:i.ZERO,[hf]:i.ONE,[uf]:i.SRC_COLOR,[Qc]:i.SRC_ALPHA,[_f]:i.SRC_ALPHA_SATURATE,[mf]:i.DST_COLOR,[ff]:i.DST_ALPHA,[df]:i.ONE_MINUS_SRC_COLOR,[eh]:i.ONE_MINUS_SRC_ALPHA,[gf]:i.ONE_MINUS_DST_COLOR,[pf]:i.ONE_MINUS_DST_ALPHA,[bf]:i.CONSTANT_COLOR,[xf]:i.ONE_MINUS_CONSTANT_COLOR,[yf]:i.CONSTANT_ALPHA,[vf]:i.ONE_MINUS_CONSTANT_ALPHA};function Ft(C,J,V,oe,ie,re,Ae,He,ne,Te){if(C===cs){g===!0&&(Oe(i.BLEND),g=!1);return}if(g===!1&&(me(i.BLEND),g=!0),C!==sf){if(C!==p||Te!==R){if((x!==hs||S!==hs)&&(i.blendEquation(i.FUNC_ADD),x=hs,S=hs),Te)switch(C){case or:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case Jc:i.blendFunc(i.ONE,i.ONE);break;case $c:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case Zc:i.blendFuncSeparate(i.DST_COLOR,i.ONE_MINUS_SRC_ALPHA,i.ZERO,i.ONE);break;default:Pe("WebGLState: Invalid blending: ",C);break}else switch(C){case or:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case Jc:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE,i.ONE,i.ONE);break;case $c:Pe("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case Zc:Pe("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:Pe("WebGLState: Invalid blending: ",C);break}w=null,y=null,E=null,_=null,A.set(0,0,0),k=0,p=C,R=Te}return}ie=ie||J,re=re||V,Ae=Ae||oe,(J!==x||ie!==S)&&(i.blendEquationSeparate(it[J],it[ie]),x=J,S=ie),(V!==w||oe!==y||re!==E||Ae!==_)&&(i.blendFuncSeparate(Xe[V],Xe[oe],Xe[re],Xe[Ae]),w=V,y=oe,E=re,_=Ae),(He.equals(A)===!1||ne!==k)&&(i.blendColor(He.r,He.g,He.b,ne),A.copy(He),k=ne),p=C,R=!1}function yt(C,J){C.side===on?Oe(i.CULL_FACE):me(i.CULL_FACE);let V=C.side===en;J&&(V=!V),tn(V),C.blending===or&&C.transparent===!1?Ft(cs):Ft(C.blending,C.blendEquation,C.blendSrc,C.blendDst,C.blendEquationAlpha,C.blendSrcAlpha,C.blendDstAlpha,C.blendColor,C.blendAlpha,C.premultipliedAlpha),a.setFunc(C.depthFunc),a.setTest(C.depthTest),a.setMask(C.depthWrite),r.setMask(C.colorWrite);let oe=C.stencilWrite;o.setTest(oe),oe&&(o.setMask(C.stencilWriteMask),o.setFunc(C.stencilFunc,C.stencilRef,C.stencilFuncMask),o.setOp(C.stencilFail,C.stencilZFail,C.stencilZPass)),Tt(C.polygonOffset,C.polygonOffsetFactor,C.polygonOffsetUnits),C.alphaToCoverage===!0?me(i.SAMPLE_ALPHA_TO_COVERAGE):Oe(i.SAMPLE_ALPHA_TO_COVERAGE)}function tn(C){D!==C&&(C?i.frontFace(i.CW):i.frontFace(i.CCW),D=C)}function ht(C){C!==ef?(me(i.CULL_FACE),C!==B&&(C===Kc?i.cullFace(i.BACK):C===tf?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):Oe(i.CULL_FACE),B=C}function Vn(C){C!==W&&(z&&i.lineWidth(C),W=C)}function Tt(C,J,V){C?(me(i.POLYGON_OFFSET_FILL),(I!==J||G!==V)&&(I=J,G=V,a.getReversed()&&(J=-J,V=-V),i.polygonOffset(J,V))):Oe(i.POLYGON_OFFSET_FILL)}function _n(C){C?me(i.SCISSOR_TEST):Oe(i.SCISSOR_TEST)}function bn(C){C===void 0&&(C=i.TEXTURE0+j-1),Z!==C&&(i.activeTexture(C),Z=C)}function xn(C,J,V){V===void 0&&(Z===null?V=i.TEXTURE0+j-1:V=Z);let oe=Q[V];oe===void 0&&(oe={type:void 0,texture:void 0},Q[V]=oe),(oe.type!==C||oe.texture!==J)&&(Z!==V&&(i.activeTexture(V),Z=V),i.bindTexture(C,J||Re[C]),oe.type=C,oe.texture=J)}function N(){let C=Q[Z];C!==void 0&&C.type!==void 0&&(i.bindTexture(C.type,null),C.type=void 0,C.texture=void 0)}function yn(){try{i.compressedTexImage2D(...arguments)}catch(C){Pe("WebGLState:",C)}}function lt(){try{i.compressedTexImage3D(...arguments)}catch(C){Pe("WebGLState:",C)}}function ct(){try{i.texSubImage2D(...arguments)}catch(C){Pe("WebGLState:",C)}}function ue(){try{i.texSubImage3D(...arguments)}catch(C){Pe("WebGLState:",C)}}function vt(){try{i.compressedTexSubImage2D(...arguments)}catch(C){Pe("WebGLState:",C)}}function Ce(){try{i.compressedTexSubImage3D(...arguments)}catch(C){Pe("WebGLState:",C)}}function Ne(){try{i.texStorage2D(...arguments)}catch(C){Pe("WebGLState:",C)}}function T(){try{i.texStorage3D(...arguments)}catch(C){Pe("WebGLState:",C)}}function v(){try{i.texImage2D(...arguments)}catch(C){Pe("WebGLState:",C)}}function U(){try{i.texImage3D(...arguments)}catch(C){Pe("WebGLState:",C)}}function ee(C){return u[C]!==void 0?u[C]:i.getParameter(C)}function $(C,J){u[C]!==J&&(i.pixelStorei(C,J),u[C]=J)}function se(C){K.equals(C)===!1&&(i.scissor(C.x,C.y,C.z,C.w),K.copy(C))}function ce(C){pe.equals(C)===!1&&(i.viewport(C.x,C.y,C.z,C.w),pe.copy(C))}function X(C,J){let V=c.get(J);V===void 0&&(V=new WeakMap,c.set(J,V));let oe=V.get(C);oe===void 0&&(oe=i.getUniformBlockIndex(J,C.name),i.uniformBlockBinding(J,oe,oe),V.set(C,oe))}function Y(C,J,V){let ie=c.get(J).get(C);l[ie]!==V&&(i.bindBufferBase(i.UNIFORM_BUFFER,ie,V),l[ie]=V)}function ae(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),a.setReversed(!1),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),i.pixelStorei(i.PACK_ALIGNMENT,4),i.pixelStorei(i.UNPACK_ALIGNMENT,4),i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,!1),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,i.BROWSER_DEFAULT_WEBGL),i.pixelStorei(i.PACK_ROW_LENGTH,0),i.pixelStorei(i.PACK_SKIP_PIXELS,0),i.pixelStorei(i.PACK_SKIP_ROWS,0),i.pixelStorei(i.UNPACK_ROW_LENGTH,0),i.pixelStorei(i.UNPACK_IMAGE_HEIGHT,0),i.pixelStorei(i.UNPACK_SKIP_PIXELS,0),i.pixelStorei(i.UNPACK_SKIP_ROWS,0),i.pixelStorei(i.UNPACK_SKIP_IMAGES,0),h={},u={},Z=null,Q={},d={},l={},f=new WeakMap,m=[],b=null,g=!1,p=null,x=null,w=null,y=null,S=null,E=null,_=null,A=new Ee(0,0,0),k=0,R=!1,D=null,B=null,W=null,I=null,G=null,K.set(0,0,i.canvas.width,i.canvas.height),pe.set(0,0,i.canvas.width,i.canvas.height),r.reset(),a.reset(),o.reset()}return{buffers:{color:r,depth:a,stencil:o},enable:me,disable:Oe,bindFramebuffer:mt,drawBuffers:Le,useProgram:Ze,setBlending:Ft,setMaterial:yt,setFlipSided:tn,setCullFace:ht,setLineWidth:Vn,setPolygonOffset:Tt,setScissorTest:_n,activeTexture:bn,bindTexture:xn,unbindTexture:N,compressedTexImage2D:yn,compressedTexImage3D:lt,texImage2D:v,texImage3D:U,pixelStorei:$,getParameter:ee,updateUBOMapping:X,uniformBlockBinding:Y,texStorage2D:Ne,texStorage3D:T,texSubImage2D:ct,texSubImage3D:ue,compressedTexSubImage2D:vt,compressedTexSubImage3D:Ce,scissor:se,viewport:ce,reset:ae}}function Vv(i,e,t,n,s,r,a){let o=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new Ie,h=new WeakMap,u=new Set,d,f=new WeakMap,m=new Set,b=new FinalizationRegistry(T=>m.delete(T)),g=!1;try{g=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function p(T,v){return g?new OffscreenCanvas(T,v):qs("canvas")}function x(T,v,U){let ee=1,$=Ne(T);if(($.width>U||$.height>U)&&(ee=U/Math.max($.width,$.height)),ee<1)if(typeof HTMLImageElement<"u"&&T instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&T instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&T instanceof ImageBitmap||typeof VideoFrame<"u"&&T instanceof VideoFrame){let se=Math.floor(ee*$.width),ce=Math.floor(ee*$.height);d===void 0&&(d=p(se,ce));let X=v?p(se,ce):d;return X.width=se,X.height=ce,X.getContext("2d").drawImage(T,0,0,se,ce),Se("WebGLRenderer: Texture has been resized from ("+$.width+"x"+$.height+") to ("+se+"x"+ce+")."),X}else return"data"in T&&Se("WebGLRenderer: Image in DataTexture is too big ("+$.width+"x"+$.height+")."),T;return T}function w(T){return T.generateMipmaps}function y(T){i.generateMipmap(T)}function S(T){return T.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:T.isWebGL3DRenderTarget?i.TEXTURE_3D:T.isWebGLArrayRenderTarget||T.isCompressedArrayTexture?i.TEXTURE_2D_ARRAY:i.TEXTURE_2D}function E(T,v,U,ee,$,se=!1){if(T!==null){if(i[T]!==void 0)return i[T];Se("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+T+"'")}let ce;ee&&(ce=e.get("EXT_texture_norm16"),ce||Se("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let X=v;if(v===i.RED&&(U===i.FLOAT&&(X=i.R32F),U===i.HALF_FLOAT&&(X=i.R16F),U===i.UNSIGNED_BYTE&&(X=i.R8),U===i.UNSIGNED_SHORT&&ce&&(X=ce.R16_EXT),U===i.SHORT&&ce&&(X=ce.R16_SNORM_EXT)),v===i.RED_INTEGER&&(U===i.UNSIGNED_BYTE&&(X=i.R8UI),U===i.UNSIGNED_SHORT&&(X=i.R16UI),U===i.UNSIGNED_INT&&(X=i.R32UI),U===i.BYTE&&(X=i.R8I),U===i.SHORT&&(X=i.R16I),U===i.INT&&(X=i.R32I)),v===i.RG&&(U===i.FLOAT&&(X=i.RG32F),U===i.HALF_FLOAT&&(X=i.RG16F),U===i.UNSIGNED_BYTE&&(X=i.RG8),U===i.UNSIGNED_SHORT&&ce&&(X=ce.RG16_EXT),U===i.SHORT&&ce&&(X=ce.RG16_SNORM_EXT)),v===i.RG_INTEGER&&(U===i.UNSIGNED_BYTE&&(X=i.RG8UI),U===i.UNSIGNED_SHORT&&(X=i.RG16UI),U===i.UNSIGNED_INT&&(X=i.RG32UI),U===i.BYTE&&(X=i.RG8I),U===i.SHORT&&(X=i.RG16I),U===i.INT&&(X=i.RG32I)),v===i.RGB_INTEGER&&(U===i.UNSIGNED_BYTE&&(X=i.RGB8UI),U===i.UNSIGNED_SHORT&&(X=i.RGB16UI),U===i.UNSIGNED_INT&&(X=i.RGB32UI),U===i.BYTE&&(X=i.RGB8I),U===i.SHORT&&(X=i.RGB16I),U===i.INT&&(X=i.RGB32I)),v===i.RGBA_INTEGER&&(U===i.UNSIGNED_BYTE&&(X=i.RGBA8UI),U===i.UNSIGNED_SHORT&&(X=i.RGBA16UI),U===i.UNSIGNED_INT&&(X=i.RGBA32UI),U===i.BYTE&&(X=i.RGBA8I),U===i.SHORT&&(X=i.RGBA16I),U===i.INT&&(X=i.RGBA32I)),v===i.RGB&&(U===i.UNSIGNED_SHORT&&ce&&(X=ce.RGB16_EXT),U===i.SHORT&&ce&&(X=ce.RGB16_SNORM_EXT),U===i.UNSIGNED_INT_5_9_9_9_REV&&(X=i.RGB9_E5),U===i.UNSIGNED_INT_10F_11F_11F_REV&&(X=i.R11F_G11F_B10F)),v===i.RGBA){let Y=se?Fr:Ge.getTransfer($);U===i.FLOAT&&(X=i.RGBA32F),U===i.HALF_FLOAT&&(X=i.RGBA16F),U===i.UNSIGNED_BYTE&&(X=Y===$e?i.SRGB8_ALPHA8:i.RGBA8),U===i.UNSIGNED_SHORT&&ce&&(X=ce.RGBA16_EXT),U===i.SHORT&&ce&&(X=ce.RGBA16_SNORM_EXT),U===i.UNSIGNED_SHORT_4_4_4_4&&(X=i.RGBA4),U===i.UNSIGNED_SHORT_5_5_5_1&&(X=i.RGB5_A1)}return(X===i.R16F||X===i.R32F||X===i.RG16F||X===i.RG32F||X===i.RGBA16F||X===i.RGBA32F)&&e.get("EXT_color_buffer_float"),X}function _(T,v){let U;return T?v===null||v===Bn||v===fs?U=i.DEPTH24_STENCIL8:v===fn?U=i.DEPTH32F_STENCIL8:v===hr&&(U=i.DEPTH24_STENCIL8,Se("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):v===null||v===Bn||v===fs?U=i.DEPTH_COMPONENT24:v===fn?U=i.DEPTH_COMPONENT32F:v===hr&&(U=i.DEPTH_COMPONENT16),U}function A(T,v){return w(T)===!0||T.isFramebufferTexture&&T.minFilter!==pt&&T.minFilter!==St?Math.log2(Math.max(v.width,v.height))+1:T.mipmaps.length>0?T.mipmaps.length:T.isCompressedTexture&&Array.isArray(T.image)?v.mipmaps.length:1}function k(T){let v=new WeakRef(T);n.get(T).__ref=v,m.add(v),b.register(T,v,v)}function R(T){let v=n.get(T).__ref;v!==void 0&&(m.delete(v),b.unregister(v))}function D(T){W(T.target)}function B(T){I(T.target)}function W(T){T.removeEventListener("dispose",D),R(T),j(T),T.isVideoTexture&&h.delete(T),T.isHTMLTexture&&u.delete(T)}function I(T){T.removeEventListener("dispose",B),R(T),te(T)}function G(){for(let T of m){let v=T.deref();v!==void 0&&(v.isRenderTarget===!0?I(v):W(v))}m.clear(),u.clear()}function j(T){let v=n.get(T);if(v.__webglInit===void 0)return;let U=T.source,ee=f.get(U);if(ee){let $=ee[v.__cacheKey];$.usedTimes--,$.usedTimes===0&&z(T),Object.keys(ee).length===0&&f.delete(U)}n.remove(T)}function z(T){let v=n.get(T);i.deleteTexture(v.__webglTexture);let U=T.source,ee=f.get(U);delete ee[v.__cacheKey],a.memory.textures--}function te(T){let v=n.get(T);v.__depthDisposeCallback&&v.__depthDisposeCallback();let U=T.depthTexture;if(U&&U.renderTarget===T&&W(U),T.isWebGLCubeRenderTarget)for(let $=0;$<6;$++){if(Array.isArray(v.__webglFramebuffer[$]))for(let se=0;se<v.__webglFramebuffer[$].length;se++)i.deleteFramebuffer(v.__webglFramebuffer[$][se]);else i.deleteFramebuffer(v.__webglFramebuffer[$]);v.__webglDepthbuffer&&i.deleteRenderbuffer(v.__webglDepthbuffer[$])}else{if(Array.isArray(v.__webglFramebuffer))for(let $=0;$<v.__webglFramebuffer.length;$++)i.deleteFramebuffer(v.__webglFramebuffer[$]);else i.deleteFramebuffer(v.__webglFramebuffer);if(v.__webglDepthbuffer&&i.deleteRenderbuffer(v.__webglDepthbuffer),v.__webglMultisampledFramebuffer&&i.deleteFramebuffer(v.__webglMultisampledFramebuffer),v.__webglColorRenderbuffer)for(let $=0;$<v.__webglColorRenderbuffer.length;$++)v.__webglColorRenderbuffer[$]&&i.deleteRenderbuffer(v.__webglColorRenderbuffer[$]);v.__webglDepthRenderbuffer&&i.deleteRenderbuffer(v.__webglDepthRenderbuffer)}let ee=T.textures;for(let $=0,se=ee.length;$<se;$++){let ce=n.get(ee[$]);ce.__webglTexture&&(i.deleteTexture(ce.__webglTexture),a.memory.textures--),n.remove(ee[$])}n.remove(T)}let q=0;function Z(){q=0}function Q(){return q}function we(T){q=T}function Fe(){let T=q;return T>=s.maxTextures&&Se("WebGLTextures: Trying to use "+(T+1)+" texture units while this GPU supports only "+s.maxTextures),q+=1,T}function K(T){let v=[];return v.push(T.wrapS),v.push(T.wrapT),v.push(T.wrapR||0),v.push(T.magFilter),v.push(T.minFilter),v.push(T.anisotropy),v.push(T.internalFormat),v.push(T.format),v.push(T.type),v.push(T.generateMipmaps),v.push(T.mipmapsAutoUpdate),v.push(T.premultiplyAlpha),v.push(T.flipY),v.push(T.unpackAlignment),v.push(T.colorSpace),v.join()}function pe(T,v){let U=n.get(T);if(T.isVideoTexture&&vt(T),T.isRenderTargetTexture===!1&&T.isExternalTexture!==!0&&T.version>0&&U.__version!==T.version){let ee=T.image;if(ee===null)Se("WebGLRenderer: Texture marked for update but no image data found.");else if(ee.complete===!1)Se("WebGLRenderer: Texture marked for update but image is incomplete");else{yt(U,T,v);return}}else T.isExternalTexture&&(U.__webglTexture=T.sourceTexture?T.sourceTexture:null);t.bindTexture(i.TEXTURE_2D,U.__webglTexture,i.TEXTURE0+v)}function xe(T,v){let U=n.get(T);if(T.isRenderTargetTexture===!1&&T.version>0&&U.__version!==T.version){yt(U,T,v);return}else T.isExternalTexture&&(U.__webglTexture=T.sourceTexture?T.sourceTexture:null);t.bindTexture(i.TEXTURE_2D_ARRAY,U.__webglTexture,i.TEXTURE0+v)}function Re(T,v){let U=n.get(T);if(T.isRenderTargetTexture===!1&&T.version>0&&U.__version!==T.version){yt(U,T,v);return}t.bindTexture(i.TEXTURE_3D,U.__webglTexture,i.TEXTURE0+v)}function me(T,v){let U=n.get(T);if(T.version>0&&U.__version!==T.version){tn(U,T,v);return}t.bindTexture(i.TEXTURE_CUBE_MAP,U.__webglTexture,i.TEXTURE0+v)}let Oe={[Pi]:i.REPEAT,[wn]:i.CLAMP_TO_EDGE,[Vs]:i.MIRRORED_REPEAT},mt={[pt]:i.NEAREST,[Fo]:i.NEAREST_MIPMAP_NEAREST,[ds]:i.NEAREST_MIPMAP_LINEAR,[St]:i.LINEAR,[cr]:i.LINEAR_MIPMAP_NEAREST,[An]:i.LINEAR_MIPMAP_LINEAR},Le={[Cf]:i.NEVER,[xh]:i.ALWAYS,[Lf]:i.LESS,[_h]:i.LEQUAL,[Pf]:i.EQUAL,[bh]:i.GEQUAL,[If]:i.GREATER,[kf]:i.NOTEQUAL};function Ze(T,v){if(v.type===fn&&e.has("OES_texture_float_linear")===!1&&(v.magFilter===St||v.magFilter===cr||v.magFilter===ds||v.magFilter===An||v.minFilter===St||v.minFilter===cr||v.minFilter===ds||v.minFilter===An)&&Se("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),i.texParameteri(T,i.TEXTURE_WRAP_S,Oe[v.wrapS]),i.texParameteri(T,i.TEXTURE_WRAP_T,Oe[v.wrapT]),(T===i.TEXTURE_3D||T===i.TEXTURE_2D_ARRAY)&&i.texParameteri(T,i.TEXTURE_WRAP_R,Oe[v.wrapR]),i.texParameteri(T,i.TEXTURE_MAG_FILTER,mt[v.magFilter]),i.texParameteri(T,i.TEXTURE_MIN_FILTER,mt[v.minFilter]),v.compareFunction&&(i.texParameteri(T,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(T,i.TEXTURE_COMPARE_FUNC,Le[v.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(v.magFilter===pt||v.minFilter!==ds&&v.minFilter!==An||v.type===fn&&e.has("OES_texture_float_linear")===!1)return;if(v.anisotropy>1||n.get(v).__currentAnisotropy){let U=e.get("EXT_texture_filter_anisotropic");i.texParameterf(T,U.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(v.anisotropy,s.getMaxAnisotropy())),n.get(v).__currentAnisotropy=v.anisotropy}}}function it(T,v){let U=!1;T.__webglInit===void 0&&(T.__webglInit=!0,v.addEventListener("dispose",D),k(v));let ee=v.source,$=f.get(ee);$===void 0&&($={},f.set(ee,$));let se=K(v);if(se!==T.__cacheKey){$[se]===void 0&&($[se]={texture:i.createTexture(),usedTimes:0},a.memory.textures++,U=!0),$[se].usedTimes++;let ce=$[T.__cacheKey];ce!==void 0&&($[T.__cacheKey].usedTimes--,ce.usedTimes===0&&z(v)),T.__cacheKey=se,T.__webglTexture=$[se].texture}return U}function Xe(T,v,U){return Math.floor(Math.floor(T/U)/v)}function Ft(T,v,U,ee){let se=T.updateRanges;if(se.length===0)t.texSubImage2D(i.TEXTURE_2D,0,0,0,v.width,v.height,U,ee,v.data);else{se.sort((C,J)=>C.start-J.start);let ce=0;for(let C=1;C<se.length;C++){let J=se[ce],V=se[C],oe=J.start+J.count,ie=Xe(V.start,v.width,4),re=Xe(J.start,v.width,4);V.start<=oe+1&&ie===re&&Xe(V.start+V.count-1,v.width,4)===ie?J.count=Math.max(J.count,V.start+V.count-J.start):(++ce,se[ce]=V)}se.length=ce+1;let X=t.getParameter(i.UNPACK_ROW_LENGTH),Y=t.getParameter(i.UNPACK_SKIP_PIXELS),ae=t.getParameter(i.UNPACK_SKIP_ROWS);t.pixelStorei(i.UNPACK_ROW_LENGTH,v.width);for(let C=0,J=se.length;C<J;C++){let V=se[C],oe=Math.floor(V.start/4),ie=Math.ceil(V.count/4),re=oe%v.width,Ae=Math.floor(oe/v.width),He=ie,ne=1;t.pixelStorei(i.UNPACK_SKIP_PIXELS,re),t.pixelStorei(i.UNPACK_SKIP_ROWS,Ae),t.texSubImage2D(i.TEXTURE_2D,0,re,Ae,He,ne,U,ee,v.data)}T.clearUpdateRanges(),t.pixelStorei(i.UNPACK_ROW_LENGTH,X),t.pixelStorei(i.UNPACK_SKIP_PIXELS,Y),t.pixelStorei(i.UNPACK_SKIP_ROWS,ae)}}function yt(T,v,U){let ee=i.TEXTURE_2D;(v.isDataArrayTexture||v.isCompressedArrayTexture)&&(ee=i.TEXTURE_2D_ARRAY),v.isData3DTexture&&(ee=i.TEXTURE_3D);let $=it(T,v),se=v.source;t.bindTexture(ee,T.__webglTexture,i.TEXTURE0+U);let ce=n.get(se);if(se.version!==ce.__version||$===!0){if(t.activeTexture(i.TEXTURE0+U),(typeof ImageBitmap<"u"&&v.image instanceof ImageBitmap)===!1){let ne=Ge.getPrimaries(Ge.workingColorSpace),Te=v.colorSpace===yi?null:Ge.getPrimaries(v.colorSpace),Be=v.colorSpace===yi||ne===Te?i.NONE:i.BROWSER_DEFAULT_WEBGL;t.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,v.flipY),t.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,v.premultiplyAlpha),t.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,Be)}t.pixelStorei(i.UNPACK_ALIGNMENT,v.unpackAlignment);let Y=x(v.image,!1,s.maxTextureSize);Y=Ce(v,Y);let ae=r.convert(v.format,v.colorSpace),C=r.convert(v.type),J=E(v.internalFormat,ae,C,v.normalized,v.colorSpace,v.isVideoTexture);Ze(ee,v);let V,oe=v.mipmaps,ie=v.isVideoTexture!==!0,re=ce.__version===void 0||$===!0,Ae=se.dataReady,He=A(v,Y);if(v.isDepthTexture)J=_(v.format===xi,v.type),re&&(ie?t.texStorage2D(i.TEXTURE_2D,1,J,Y.width,Y.height):t.texImage2D(i.TEXTURE_2D,0,J,Y.width,Y.height,0,ae,C,null));else if(v.isDataTexture)if(oe.length>0){ie&&re&&t.texStorage2D(i.TEXTURE_2D,He,J,oe[0].width,oe[0].height);for(let ne=0,Te=oe.length;ne<Te;ne++)V=oe[ne],ie?Ae&&t.texSubImage2D(i.TEXTURE_2D,ne,0,0,V.width,V.height,ae,C,V.data):t.texImage2D(i.TEXTURE_2D,ne,J,V.width,V.height,0,ae,C,V.data);v.generateMipmaps=!1}else ie?(re&&t.texStorage2D(i.TEXTURE_2D,He,J,Y.width,Y.height),Ae&&Ft(v,Y,ae,C)):t.texImage2D(i.TEXTURE_2D,0,J,Y.width,Y.height,0,ae,C,Y.data);else if(v.isCompressedTexture)if(v.isCompressedArrayTexture){ie&&re&&t.texStorage3D(i.TEXTURE_2D_ARRAY,He,J,oe[0].width,oe[0].height,Y.depth);for(let ne=0,Te=oe.length;ne<Te;ne++)if(V=oe[ne],v.format!==En)if(ae!==null)if(ie){if(Ae)if(v.layerUpdates.size>0){let Be=Ch(V.width,V.height,v.format,v.type);for(let de of v.layerUpdates){let Qe=V.data.subarray(de*Be/V.data.BYTES_PER_ELEMENT,(de+1)*Be/V.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,ne,0,0,de,V.width,V.height,1,ae,Qe)}}else t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,ne,0,0,0,V.width,V.height,Y.depth,ae,V.data)}else t.compressedTexImage3D(i.TEXTURE_2D_ARRAY,ne,J,V.width,V.height,Y.depth,0,V.data,0,0);else Se("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else ie?Ae&&t.texSubImage3D(i.TEXTURE_2D_ARRAY,ne,0,0,0,V.width,V.height,Y.depth,ae,C,V.data):t.texImage3D(i.TEXTURE_2D_ARRAY,ne,J,V.width,V.height,Y.depth,0,ae,C,V.data);v.layerUpdates.size>0&&v.clearLayerUpdates()}else{ie&&re&&t.texStorage2D(i.TEXTURE_2D,He,J,oe[0].width,oe[0].height);for(let ne=0,Te=oe.length;ne<Te;ne++)V=oe[ne],v.format!==En?ae!==null?ie?Ae&&t.compressedTexSubImage2D(i.TEXTURE_2D,ne,0,0,V.width,V.height,ae,V.data):t.compressedTexImage2D(i.TEXTURE_2D,ne,J,V.width,V.height,0,V.data):Se("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):ie?Ae&&t.texSubImage2D(i.TEXTURE_2D,ne,0,0,V.width,V.height,ae,C,V.data):t.texImage2D(i.TEXTURE_2D,ne,J,V.width,V.height,0,ae,C,V.data)}else if(v.isDataArrayTexture)if(ie){if(re&&t.texStorage3D(i.TEXTURE_2D_ARRAY,He,J,Y.width,Y.height,Y.depth),Ae)if(v.layerUpdates.size>0){let ne=Ch(Y.width,Y.height,v.format,v.type);for(let Te of v.layerUpdates){let Be=Y.data.subarray(Te*ne/Y.data.BYTES_PER_ELEMENT,(Te+1)*ne/Y.data.BYTES_PER_ELEMENT);t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,Te,Y.width,Y.height,1,ae,C,Be)}v.clearLayerUpdates()}else t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,Y.width,Y.height,Y.depth,ae,C,Y.data)}else t.texImage3D(i.TEXTURE_2D_ARRAY,0,J,Y.width,Y.height,Y.depth,0,ae,C,Y.data);else if(v.isData3DTexture)ie?(re&&t.texStorage3D(i.TEXTURE_3D,He,J,Y.width,Y.height,Y.depth),Ae&&t.texSubImage3D(i.TEXTURE_3D,0,0,0,0,Y.width,Y.height,Y.depth,ae,C,Y.data)):t.texImage3D(i.TEXTURE_3D,0,J,Y.width,Y.height,Y.depth,0,ae,C,Y.data);else if(v.isFramebufferTexture){if(re)if(ie)t.texStorage2D(i.TEXTURE_2D,He,J,Y.width,Y.height);else{let ne=Y.width,Te=Y.height;for(let Be=0;Be<He;Be++)t.texImage2D(i.TEXTURE_2D,Be,J,ne,Te,0,ae,C,null),ne>>=1,Te>>=1}}else if(v.isHTMLTexture){if("texElementImage2D"in i){let ne=i.canvas;if(ne.hasAttribute("layoutsubtree")||ne.setAttribute("layoutsubtree","true"),Y.parentNode!==ne){ne.appendChild(Y),u.add(v),ne.onpaint=Te=>{let Be=Te.changedElements;for(let de of u)Be.includes(de.image)&&(de.needsUpdate=!0)},ne.requestPaint();return}if(i.texElementImage2D.length===3)i.texElementImage2D(i.TEXTURE_2D,i.RGBA8,Y);else{let Be=i.RGBA,de=i.RGBA,Qe=i.UNSIGNED_BYTE;i.texElementImage2D(i.TEXTURE_2D,0,Be,de,Qe,Y)}i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MIN_FILTER,i.LINEAR),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE)}}else if(oe.length>0){if(ie&&re){let ne=Ne(oe[0]);t.texStorage2D(i.TEXTURE_2D,He,J,ne.width,ne.height)}for(let ne=0,Te=oe.length;ne<Te;ne++)V=oe[ne],ie?Ae&&t.texSubImage2D(i.TEXTURE_2D,ne,0,0,ae,C,V):t.texImage2D(i.TEXTURE_2D,ne,J,ae,C,V);v.generateMipmaps=!1}else if(ie){if(re){let ne=Ne(Y);t.texStorage2D(i.TEXTURE_2D,He,J,ne.width,ne.height)}Ae&&t.texSubImage2D(i.TEXTURE_2D,0,0,0,ae,C,Y)}else t.texImage2D(i.TEXTURE_2D,0,J,ae,C,Y);w(v)&&v.mipmapsAutoUpdate===!0&&y(ee),ce.__version=se.version,v.onUpdate&&v.onUpdate(v)}T.__version=v.version}function tn(T,v,U){if(v.image.length!==6)return;let ee=it(T,v),$=v.source;t.bindTexture(i.TEXTURE_CUBE_MAP,T.__webglTexture,i.TEXTURE0+U);let se=n.get($);if($.version!==se.__version||ee===!0){t.activeTexture(i.TEXTURE0+U);let ce=Ge.getPrimaries(Ge.workingColorSpace),X=v.colorSpace===yi?null:Ge.getPrimaries(v.colorSpace),Y=v.colorSpace===yi||ce===X?i.NONE:i.BROWSER_DEFAULT_WEBGL;t.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,v.flipY),t.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,v.premultiplyAlpha),t.pixelStorei(i.UNPACK_ALIGNMENT,v.unpackAlignment),t.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,Y);let ae=v.isCompressedTexture||v.image[0].isCompressedTexture,C=v.image[0]&&v.image[0].isDataTexture,J=[];for(let de=0;de<6;de++)!ae&&!C?J[de]=x(v.image[de],!0,s.maxCubemapSize):J[de]=C?v.image[de].image:v.image[de],J[de]=Ce(v,J[de]);let V=J[0],oe=r.convert(v.format,v.colorSpace),ie=r.convert(v.type),re=E(v.internalFormat,oe,ie,v.normalized,v.colorSpace),Ae=v.isVideoTexture!==!0,He=se.__version===void 0||ee===!0,ne=$.dataReady,Te=A(v,V);Ze(i.TEXTURE_CUBE_MAP,v);let Be;if(v.isDepthTexture){if(re=_(v.format===xi,v.type),He)if(Ae)t.texStorage2D(i.TEXTURE_CUBE_MAP,1,re,V.width,V.height);else for(let de=0;de<6;de++)t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+de,0,re,V.width,V.height,0,oe,ie,null)}else if(ae){Ae&&He&&t.texStorage2D(i.TEXTURE_CUBE_MAP,Te,re,V.width,V.height);for(let de=0;de<6;de++){Be=J[de].mipmaps;for(let Qe=0;Qe<Be.length;Qe++){let Rt=Be[Qe];v.format!==En?oe!==null?Ae?ne&&t.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+de,Qe,0,0,Rt.width,Rt.height,oe,Rt.data):t.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+de,Qe,re,Rt.width,Rt.height,0,Rt.data):Se("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):Ae?ne&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+de,Qe,0,0,Rt.width,Rt.height,oe,ie,Rt.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+de,Qe,re,Rt.width,Rt.height,0,oe,ie,Rt.data)}}}else{if(Be=v.mipmaps,Ae&&He){Be.length>0&&Te++;let de=Ne(J[0]);t.texStorage2D(i.TEXTURE_CUBE_MAP,Te,re,de.width,de.height)}for(let de=0;de<6;de++)if(C){Ae?ne&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+de,0,0,0,J[de].width,J[de].height,oe,ie,J[de].data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+de,0,re,J[de].width,J[de].height,0,oe,ie,J[de].data);for(let Qe=0;Qe<Be.length;Qe++){let Mi=Be[Qe].image[de].image;Ae?ne&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+de,Qe+1,0,0,Mi.width,Mi.height,oe,ie,Mi.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+de,Qe+1,re,Mi.width,Mi.height,0,oe,ie,Mi.data)}}else{Ae?ne&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+de,0,0,0,oe,ie,J[de]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+de,0,re,oe,ie,J[de]);for(let Qe=0;Qe<Be.length;Qe++){let Rt=Be[Qe];Ae?ne&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+de,Qe+1,0,0,oe,ie,Rt.image[de]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+de,Qe+1,re,oe,ie,Rt.image[de])}}}w(v)&&v.mipmapsAutoUpdate===!0&&y(i.TEXTURE_CUBE_MAP),se.__version=$.version,v.onUpdate&&v.onUpdate(v)}T.__version=v.version}function ht(T,v,U,ee,$,se){let ce=r.convert(U.format,U.colorSpace),X=r.convert(U.type),Y=E(U.internalFormat,ce,X,U.normalized,U.colorSpace),ae=n.get(v),C=n.get(U);if(C.__renderTarget=v,!ae.__hasExternalTextures){let J=Math.max(1,v.width>>se),V=Math.max(1,v.height>>se);$===i.TEXTURE_3D||$===i.TEXTURE_2D_ARRAY?t.texImage3D($,se,Y,J,V,v.depth,0,ce,X,null):t.texImage2D($,se,Y,J,V,0,ce,X,null)}t.bindFramebuffer(i.FRAMEBUFFER,T),ue(v)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,ee,$,C.__webglTexture,0,ct(v)):($===i.TEXTURE_2D||$>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&$<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,ee,$,C.__webglTexture,se),t.bindFramebuffer(i.FRAMEBUFFER,null)}function Vn(T,v,U){if(i.bindRenderbuffer(i.RENDERBUFFER,T),v.depthBuffer){let ee=v.depthTexture,$=ee&&ee.isDepthTexture?ee.type:null,se=_(v.stencilBuffer,$),ce=v.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;ue(v)?o.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,ct(v),se,v.width,v.height):U?i.renderbufferStorageMultisample(i.RENDERBUFFER,ct(v),se,v.width,v.height):i.renderbufferStorage(i.RENDERBUFFER,se,v.width,v.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,ce,i.RENDERBUFFER,T)}else{let ee=v.textures;for(let $=0;$<ee.length;$++){let se=ee[$],ce=r.convert(se.format,se.colorSpace),X=r.convert(se.type),Y=E(se.internalFormat,ce,X,se.normalized,se.colorSpace);ue(v)?o.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,ct(v),Y,v.width,v.height):U?i.renderbufferStorageMultisample(i.RENDERBUFFER,ct(v),Y,v.width,v.height):i.renderbufferStorage(i.RENDERBUFFER,Y,v.width,v.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function Tt(T,v,U){let ee=v.isWebGLCubeRenderTarget===!0;if(t.bindFramebuffer(i.FRAMEBUFFER,T),!(v.depthTexture&&v.depthTexture.isDepthTexture))throw new Error("THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.");let $=n.get(v.depthTexture);$.__renderTarget=v;let se=ee?v.depthTexture.image[0]:v.depthTexture.image;(!$.__webglTexture||se.width!==v.width||se.height!==v.height)&&(se.width=v.width,se.height=v.height,v.depthTexture.needsUpdate=!0),ee?me(v.depthTexture,0):pe(v.depthTexture,0);let ce=$.__webglTexture,X=ct(v),Y=ee?i.TEXTURE_CUBE_MAP_POSITIVE_X+U:i.TEXTURE_2D,ae=v.depthTexture.format===xi?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;if(v.depthTexture.format===fi)ue(v)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,ae,Y,ce,0,X):i.framebufferTexture2D(i.FRAMEBUFFER,ae,Y,ce,0);else if(v.depthTexture.format===xi)ue(v)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,ae,Y,ce,0,X):i.framebufferTexture2D(i.FRAMEBUFFER,ae,Y,ce,0);else throw new Error("THREE.WebGLTextures: Unknown depthTexture format.")}function _n(T){let v=n.get(T),U=T.isWebGLCubeRenderTarget===!0;if(v.__boundDepthTexture!==T.depthTexture){let ee=T.depthTexture;if(v.__depthDisposeCallback&&v.__depthDisposeCallback(),ee){let $=()=>{delete v.__boundDepthTexture,delete v.__depthDisposeCallback,ee.removeEventListener("dispose",$)};ee.addEventListener("dispose",$),v.__depthDisposeCallback=$}v.__boundDepthTexture=ee}if(T.depthTexture&&!v.__autoAllocateDepthBuffer)if(U)for(let ee=0;ee<6;ee++)Tt(v.__webglFramebuffer[ee],T,ee);else T.texture.mipmaps.length>0?Tt(v.__webglFramebuffer[0],T,0):Tt(v.__webglFramebuffer,T,0);else if(U){v.__webglDepthbuffer=[];for(let ee=0;ee<6;ee++)if(t.bindFramebuffer(i.FRAMEBUFFER,v.__webglFramebuffer[ee]),v.__webglDepthbuffer[ee]===void 0)v.__webglDepthbuffer[ee]=i.createRenderbuffer(),Vn(v.__webglDepthbuffer[ee],T,!1);else{let $=T.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,se=v.__webglDepthbuffer[ee];i.bindRenderbuffer(i.RENDERBUFFER,se),i.framebufferRenderbuffer(i.FRAMEBUFFER,$,i.RENDERBUFFER,se)}}else if(T.texture.mipmaps.length>0?t.bindFramebuffer(i.FRAMEBUFFER,v.__webglFramebuffer[0]):t.bindFramebuffer(i.FRAMEBUFFER,v.__webglFramebuffer),v.__webglDepthbuffer===void 0)v.__webglDepthbuffer=i.createRenderbuffer(),Vn(v.__webglDepthbuffer,T,!1);else{let $=T.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,se=v.__webglDepthbuffer;i.bindRenderbuffer(i.RENDERBUFFER,se),i.framebufferRenderbuffer(i.FRAMEBUFFER,$,i.RENDERBUFFER,se)}t.bindFramebuffer(i.FRAMEBUFFER,null)}function bn(T,v,U){let ee=n.get(T);v!==void 0&&ht(ee.__webglFramebuffer,T,T.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),U!==void 0&&_n(T)}function xn(T){let v=T.texture,U=n.get(T),ee=n.get(v);T.addEventListener("dispose",B),k(T);let $=T.textures,se=T.isWebGLCubeRenderTarget===!0,ce=$.length>1;if(ce||(ee.__webglTexture===void 0&&(ee.__webglTexture=i.createTexture()),ee.__version=v.version,a.memory.textures++),se){U.__webglFramebuffer=[];for(let X=0;X<6;X++)if(v.mipmaps.length>0){U.__webglFramebuffer[X]=[];for(let Y=0;Y<v.mipmaps.length;Y++)U.__webglFramebuffer[X][Y]=i.createFramebuffer()}else U.__webglFramebuffer[X]=i.createFramebuffer()}else{if(v.mipmaps.length>0){U.__webglFramebuffer=[];for(let X=0;X<v.mipmaps.length;X++)U.__webglFramebuffer[X]=i.createFramebuffer()}else U.__webglFramebuffer=i.createFramebuffer();if(ce)for(let X=0,Y=$.length;X<Y;X++){let ae=n.get($[X]);ae.__webglTexture===void 0&&(ae.__webglTexture=i.createTexture(),a.memory.textures++)}if(T.samples>0&&ue(T)===!1){U.__webglMultisampledFramebuffer=i.createFramebuffer(),U.__webglColorRenderbuffer=[],t.bindFramebuffer(i.FRAMEBUFFER,U.__webglMultisampledFramebuffer);for(let X=0;X<$.length;X++){let Y=$[X];U.__webglColorRenderbuffer[X]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,U.__webglColorRenderbuffer[X]);let ae=r.convert(Y.format,Y.colorSpace),C=r.convert(Y.type),J=E(Y.internalFormat,ae,C,Y.normalized,Y.colorSpace,T.isXRRenderTarget===!0),V=ct(T);i.renderbufferStorageMultisample(i.RENDERBUFFER,V,J,T.width,T.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+X,i.RENDERBUFFER,U.__webglColorRenderbuffer[X])}i.bindRenderbuffer(i.RENDERBUFFER,null),T.depthBuffer&&(U.__webglDepthRenderbuffer=i.createRenderbuffer(),Vn(U.__webglDepthRenderbuffer,T,!0)),t.bindFramebuffer(i.FRAMEBUFFER,null)}}if(se){t.bindTexture(i.TEXTURE_CUBE_MAP,ee.__webglTexture),Ze(i.TEXTURE_CUBE_MAP,v);for(let X=0;X<6;X++)if(v.mipmaps.length>0)for(let Y=0;Y<v.mipmaps.length;Y++)ht(U.__webglFramebuffer[X][Y],T,v,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+X,Y);else ht(U.__webglFramebuffer[X],T,v,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+X,0);w(v)?y(i.TEXTURE_CUBE_MAP):v.mipmaps.length>0&&i.texParameteri(i.TEXTURE_CUBE_MAP,i.TEXTURE_MAX_LEVEL,v.mipmaps.length-1),t.unbindTexture()}else if(ce){for(let X=0,Y=$.length;X<Y;X++){let ae=$[X],C=n.get(ae),J=i.TEXTURE_2D;(T.isWebGL3DRenderTarget||T.isWebGLArrayRenderTarget)&&(J=T.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),t.bindTexture(J,C.__webglTexture),Ze(J,ae),ht(U.__webglFramebuffer,T,ae,i.COLOR_ATTACHMENT0+X,J,0),w(ae)&&y(J)}t.unbindTexture()}else{let X=i.TEXTURE_2D;if((T.isWebGL3DRenderTarget||T.isWebGLArrayRenderTarget)&&(X=T.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),t.bindTexture(X,ee.__webglTexture),Ze(X,v),v.mipmaps.length>0)for(let Y=0;Y<v.mipmaps.length;Y++)ht(U.__webglFramebuffer[Y],T,v,i.COLOR_ATTACHMENT0,X,Y);else ht(U.__webglFramebuffer,T,v,i.COLOR_ATTACHMENT0,X,0);w(v)?y(X):v.mipmaps.length>0&&i.texParameteri(X,i.TEXTURE_MAX_LEVEL,v.mipmaps.length-1),t.unbindTexture()}T.depthBuffer&&_n(T)}function N(T){let v=T.textures;for(let U=0,ee=v.length;U<ee;U++){let $=v[U];if(w($)&&$.mipmapsAutoUpdate===!0){let se=S(T),ce=n.get($).__webglTexture;t.bindTexture(se,ce),y(se),t.unbindTexture()}}}let yn=[];function lt(T){if(T.samples>0){if(ue(T)===!1){let v=T.textures,U=T.width,ee=T.height,$=i.COLOR_BUFFER_BIT,se=T.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,ce=n.get(T),X=v.length>1;if(X)for(let ae=0;ae<v.length;ae++)t.bindFramebuffer(i.FRAMEBUFFER,ce.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+ae,i.RENDERBUFFER,null),t.bindFramebuffer(i.FRAMEBUFFER,ce.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+ae,i.TEXTURE_2D,null,0);t.bindFramebuffer(i.READ_FRAMEBUFFER,ce.__webglMultisampledFramebuffer),T.texture.mipmaps.length>0?t.bindFramebuffer(i.DRAW_FRAMEBUFFER,ce.__webglFramebuffer[0]):t.bindFramebuffer(i.DRAW_FRAMEBUFFER,ce.__webglFramebuffer);for(let ae=0;ae<v.length;ae++){if(T.resolveDepthBuffer&&(T.depthBuffer&&($|=i.DEPTH_BUFFER_BIT),T.stencilBuffer&&T.resolveStencilBuffer&&($|=i.STENCIL_BUFFER_BIT)),X){i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,ce.__webglColorRenderbuffer[ae]);let C=n.get(v[ae]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,C,0)}i.blitFramebuffer(0,0,U,ee,0,0,U,ee,$,i.NEAREST),l===!0&&(yn.length=0,yn.push(i.COLOR_ATTACHMENT0+ae),T.depthBuffer&&T.storeMultisampledDepthBuffer===!1&&yn.push(se),i.invalidateFramebuffer(i.READ_FRAMEBUFFER,yn))}if(t.bindFramebuffer(i.READ_FRAMEBUFFER,null),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),X)for(let ae=0;ae<v.length;ae++){t.bindFramebuffer(i.FRAMEBUFFER,ce.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+ae,i.RENDERBUFFER,ce.__webglColorRenderbuffer[ae]);let C=n.get(v[ae]).__webglTexture;t.bindFramebuffer(i.FRAMEBUFFER,ce.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+ae,i.TEXTURE_2D,C,0)}t.bindFramebuffer(i.DRAW_FRAMEBUFFER,ce.__webglMultisampledFramebuffer)}else if(T.depthBuffer&&T.storeMultisampledDepthBuffer===!1&&l){let v=T.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[v])}}}function ct(T){return Math.min(s.maxSamples,T.samples)}function ue(T){let v=n.get(T);return T.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&v.__useRenderToTexture!==!1}function vt(T){let v=a.render.frame;h.get(T)!==v&&(h.set(T,v),T.update())}function Ce(T,v){let U=T.colorSpace,ee=T.format,$=T.type;return T.isCompressedTexture===!0||T.isVideoTexture===!0||U!==Jt&&U!==yi&&(Ge.getTransfer(U)===$e?(ee!==En||$!==ln)&&Se("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):Pe("WebGLTextures: Unsupported texture color space:",U)),v}function Ne(T){return typeof HTMLImageElement<"u"&&T instanceof HTMLImageElement?(c.width=T.naturalWidth||T.width,c.height=T.naturalHeight||T.height):typeof VideoFrame<"u"&&T instanceof VideoFrame?(c.width=T.displayWidth,c.height=T.displayHeight):(c.width=T.width,c.height=T.height),c}this.allocateTextureUnit=Fe,this.resetTextureUnits=Z,this.getTextureUnits=Q,this.setTextureUnits=we,this.setTexture2D=pe,this.setTexture2DArray=xe,this.setTexture3D=Re,this.setTextureCube=me,this.rebindTextures=bn,this.setupRenderTarget=xn,this.updateRenderTargetMipmap=N,this.updateMultisampleRenderTarget=lt,this.setupDepthRenderbuffer=_n,this.setupFrameBufferTexture=ht,this.useMultisampledRTT=ue,this.dispose=G}function Wv(i,e){function t(n,s=yi){let r,a=Ge.getTransfer(s);if(n===ln)return i.UNSIGNED_BYTE;if(n===Oo)return i.UNSIGNED_SHORT_4_4_4_4;if(n===Bo)return i.UNSIGNED_SHORT_5_5_5_1;if(n===dh)return i.UNSIGNED_INT_5_9_9_9_REV;if(n===fh)return i.UNSIGNED_INT_10F_11F_11F_REV;if(n===hh)return i.BYTE;if(n===uh)return i.SHORT;if(n===hr)return i.UNSIGNED_SHORT;if(n===Uo)return i.INT;if(n===Bn)return i.UNSIGNED_INT;if(n===fn)return i.FLOAT;if(n===Hn)return i.HALF_FLOAT;if(n===ph)return i.ALPHA;if(n===mh)return i.RGB;if(n===En)return i.RGBA;if(n===fi)return i.DEPTH_COMPONENT;if(n===xi)return i.DEPTH_STENCIL;if(n===Ho)return i.RED;if(n===zo)return i.RED_INTEGER;if(n===Bi)return i.RG;if(n===Go)return i.RG_INTEGER;if(n===Vo)return i.RGBA_INTEGER;if(n===aa||n===oa||n===la||n===ca)if(a===$e)if(r=e.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(n===aa)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===oa)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===la)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===ca)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=e.get("WEBGL_compressed_texture_s3tc"),r!==null){if(n===aa)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===oa)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===la)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===ca)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===Wo||n===qo||n===Xo||n===jo)if(r=e.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(n===Wo)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===qo)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===Xo)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===jo)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===Yo||n===Ko||n===Jo||n===$o||n===Zo||n===ha||n===Qo)if(r=e.get("WEBGL_compressed_texture_etc"),r!==null){if(n===Yo||n===Ko)return a===$e?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(n===Jo)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC;if(n===$o)return r.COMPRESSED_R11_EAC;if(n===Zo)return r.COMPRESSED_SIGNED_R11_EAC;if(n===ha)return r.COMPRESSED_RG11_EAC;if(n===Qo)return r.COMPRESSED_SIGNED_RG11_EAC}else return null;if(n===el||n===tl||n===nl||n===il||n===sl||n===rl||n===al||n===ol||n===ll||n===cl||n===hl||n===ul||n===dl||n===fl)if(r=e.get("WEBGL_compressed_texture_astc"),r!==null){if(n===el)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===tl)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===nl)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===il)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===sl)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===rl)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===al)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===ol)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===ll)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===cl)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===hl)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===ul)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===dl)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===fl)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===pl||n===ml||n===gl)if(r=e.get("EXT_texture_compression_bptc"),r!==null){if(n===pl)return a===$e?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===ml)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===gl)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===_l||n===bl||n===ua||n===xl)if(r=e.get("EXT_texture_compression_rgtc"),r!==null){if(n===_l)return r.COMPRESSED_RED_RGTC1_EXT;if(n===bl)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===ua)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===xl)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===fs?i.UNSIGNED_INT_24_8:i[n]!==void 0?i[n]:null}return{convert:t}}function Yv(i,e){function t(g,p){g.matrixAutoUpdate===!0&&g.updateMatrix(),p.value.copy(g.matrix)}function n(g,p){p.color.getRGB(g.fogColor.value,Eh(i)),p.isFog?(g.fogNear.value=p.near,g.fogFar.value=p.far):p.isFogExp2&&(g.fogDensity.value=p.density)}function s(g,p,x,w,y){p.isNodeMaterial?p.uniformsNeedUpdate=!1:p.isMeshBasicMaterial?r(g,p):p.isMeshLambertMaterial?(r(g,p),p.envMap&&(g.envMapIntensity.value=p.envMapIntensity)):p.isMeshToonMaterial?(r(g,p),u(g,p)):p.isMeshPhongMaterial?(r(g,p),h(g,p),p.envMap&&(g.envMapIntensity.value=p.envMapIntensity)):p.isMeshStandardMaterial?(r(g,p),d(g,p),p.isMeshPhysicalMaterial&&f(g,p,y)):p.isMeshMatcapMaterial?(r(g,p),m(g,p)):p.isMeshDepthMaterial?r(g,p):p.isMeshDistanceMaterial?(r(g,p),b(g,p)):p.isMeshNormalMaterial?r(g,p):p.isLineBasicMaterial?(a(g,p),p.isLineDashedMaterial&&o(g,p)):p.isPointsMaterial?l(g,p,x,w):p.isSpriteMaterial?c(g,p):p.isShadowMaterial?(g.color.value.copy(p.color),g.opacity.value=p.opacity):p.isShaderMaterial&&(p.uniformsNeedUpdate=!1)}function r(g,p){g.opacity.value=p.opacity,p.color&&g.diffuse.value.copy(p.color),p.emissive&&g.emissive.value.copy(p.emissive).multiplyScalar(p.emissiveIntensity),p.map&&(g.map.value=p.map,t(p.map,g.mapTransform)),p.alphaMap&&(g.alphaMap.value=p.alphaMap,t(p.alphaMap,g.alphaMapTransform)),p.bumpMap&&(g.bumpMap.value=p.bumpMap,t(p.bumpMap,g.bumpMapTransform),g.bumpScale.value=p.bumpScale,p.side===en&&(g.bumpScale.value*=-1)),p.normalMap&&(g.normalMap.value=p.normalMap,t(p.normalMap,g.normalMapTransform),g.normalScale.value.copy(p.normalScale),p.side===en&&g.normalScale.value.negate()),p.displacementMap&&(g.displacementMap.value=p.displacementMap,t(p.displacementMap,g.displacementMapTransform),g.displacementScale.value=p.displacementScale,g.displacementBias.value=p.displacementBias),p.emissiveMap&&(g.emissiveMap.value=p.emissiveMap,t(p.emissiveMap,g.emissiveMapTransform)),p.specularMap&&(g.specularMap.value=p.specularMap,t(p.specularMap,g.specularMapTransform)),p.alphaTest>0&&(g.alphaTest.value=p.alphaTest);let x=e.get(p),w=x.envMap,y=x.envMapRotation;w&&(g.envMap.value=w,g.envMapRotation.value.setFromMatrix4(jv.makeRotationFromEuler(y)).transpose(),w.isCubeTexture&&w.isRenderTargetTexture===!1&&g.envMapRotation.value.premultiply(wp),g.reflectivity.value=p.reflectivity,g.ior.value=p.ior,g.refractionRatio.value=p.refractionRatio),p.lightMap&&(g.lightMap.value=p.lightMap,g.lightMapIntensity.value=p.lightMapIntensity,t(p.lightMap,g.lightMapTransform)),p.aoMap&&(g.aoMap.value=p.aoMap,g.aoMapIntensity.value=p.aoMapIntensity,t(p.aoMap,g.aoMapTransform))}function a(g,p){g.diffuse.value.copy(p.color),g.opacity.value=p.opacity,p.map&&(g.map.value=p.map,t(p.map,g.mapTransform))}function o(g,p){g.dashSize.value=p.dashSize,g.totalSize.value=p.dashSize+p.gapSize,g.scale.value=p.scale}function l(g,p,x,w){g.diffuse.value.copy(p.color),g.opacity.value=p.opacity,g.size.value=p.size*x,g.scale.value=w*.5,p.map&&(g.map.value=p.map,t(p.map,g.uvTransform)),p.alphaMap&&(g.alphaMap.value=p.alphaMap,t(p.alphaMap,g.alphaMapTransform)),p.alphaTest>0&&(g.alphaTest.value=p.alphaTest)}function c(g,p){g.diffuse.value.copy(p.color),g.opacity.value=p.opacity,g.rotation.value=p.rotation,p.map&&(g.map.value=p.map,t(p.map,g.mapTransform)),p.alphaMap&&(g.alphaMap.value=p.alphaMap,t(p.alphaMap,g.alphaMapTransform)),p.alphaTest>0&&(g.alphaTest.value=p.alphaTest)}function h(g,p){g.specular.value.copy(p.specular),g.shininess.value=Math.max(p.shininess,1e-4)}function u(g,p){p.gradientMap&&(g.gradientMap.value=p.gradientMap)}function d(g,p){g.metalness.value=p.metalness,p.metalnessMap&&(g.metalnessMap.value=p.metalnessMap,t(p.metalnessMap,g.metalnessMapTransform)),g.roughness.value=p.roughness,p.roughnessMap&&(g.roughnessMap.value=p.roughnessMap,t(p.roughnessMap,g.roughnessMapTransform)),p.envMap&&(g.envMapIntensity.value=p.envMapIntensity)}function f(g,p,x){g.ior.value=p.ior,p.diffuseRoughness>0&&(g.diffuseRoughness.value=p.diffuseRoughness,p.diffuseRoughnessMap&&(g.diffuseRoughnessMap.value=p.diffuseRoughnessMap,t(p.diffuseRoughnessMap,g.diffuseRoughnessMapTransform))),p.sheen>0&&(g.sheenColor.value.copy(p.sheenColor).multiplyScalar(p.sheen),g.sheenRoughness.value=p.sheenRoughness,p.sheenColorMap&&(g.sheenColorMap.value=p.sheenColorMap,t(p.sheenColorMap,g.sheenColorMapTransform)),p.sheenRoughnessMap&&(g.sheenRoughnessMap.value=p.sheenRoughnessMap,t(p.sheenRoughnessMap,g.sheenRoughnessMapTransform))),p.clearcoat>0&&(g.clearcoat.value=p.clearcoat,g.clearcoatRoughness.value=p.clearcoatRoughness,p.clearcoatMap&&(g.clearcoatMap.value=p.clearcoatMap,t(p.clearcoatMap,g.clearcoatMapTransform)),p.clearcoatRoughnessMap&&(g.clearcoatRoughnessMap.value=p.clearcoatRoughnessMap,t(p.clearcoatRoughnessMap,g.clearcoatRoughnessMapTransform)),p.clearcoatNormalMap&&(g.clearcoatNormalMap.value=p.clearcoatNormalMap,t(p.clearcoatNormalMap,g.clearcoatNormalMapTransform),g.clearcoatNormalScale.value.copy(p.clearcoatNormalScale),p.side===en&&g.clearcoatNormalScale.value.negate())),p.dispersion>0&&(g.dispersion.value=p.dispersion),p.retroreflectivity>0&&(g.retroreflectivity.value=p.retroreflectivity),p.iridescence>0&&(g.iridescence.value=p.iridescence,g.iridescenceIOR.value=p.iridescenceIOR,g.iridescenceThicknessMinimum.value=p.iridescenceThicknessMinimum,g.iridescenceThicknessMaximum.value=p.iridescenceThicknessMaximum,p.iridescenceMap&&(g.iridescenceMap.value=p.iridescenceMap,t(p.iridescenceMap,g.iridescenceMapTransform)),p.iridescenceThicknessMap&&(g.iridescenceThicknessMap.value=p.iridescenceThicknessMap,t(p.iridescenceThicknessMap,g.iridescenceThicknessMapTransform))),p.transmission>0&&(g.transmission.value=p.transmission,g.transmissionSamplerMap.value=x.texture,g.transmissionSamplerSize.value.set(x.width,x.height),p.transmissionMap&&(g.transmissionMap.value=p.transmissionMap,t(p.transmissionMap,g.transmissionMapTransform)),g.thickness.value=p.thickness,p.thicknessMap&&(g.thicknessMap.value=p.thicknessMap,t(p.thicknessMap,g.thicknessMapTransform)),g.attenuationDistance.value=p.attenuationDistance,g.attenuationColor.value.copy(p.attenuationColor)),p.anisotropy>0&&(g.anisotropyVector.value.set(p.anisotropy*Math.cos(p.anisotropyRotation),p.anisotropy*Math.sin(p.anisotropyRotation)),p.anisotropyMap&&(g.anisotropyMap.value=p.anisotropyMap,t(p.anisotropyMap,g.anisotropyMapTransform))),g.specularIntensity.value=p.specularIntensity,g.specularColor.value.copy(p.specularColor),p.specularColorMap&&(g.specularColorMap.value=p.specularColorMap,t(p.specularColorMap,g.specularColorMapTransform)),p.specularIntensityMap&&(g.specularIntensityMap.value=p.specularIntensityMap,t(p.specularIntensityMap,g.specularIntensityMapTransform))}function m(g,p){p.matcap&&(g.matcap.value=p.matcap)}function b(g,p){let x=e.get(p).light;g.referencePosition.value.setFromMatrixPosition(x.matrixWorld),g.nearDistance.value=x.shadow.camera.near,g.farDistance.value=x.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:s}}function Kv(i,e,t,n){let s={},r={};function a(x,w){let y=w.program;n.uniformBlockBinding(x,y,s[x.id])}function o(x,w){let y=s[x.id];y===void 0&&(m(x),y=l(x),s[x.id]=y,x.addEventListener("dispose",g));let S=w.program;n.updateUBOMapping(x,S);let E=e.render.frame;r[x.id]!==E&&(c(x),r[x.id]=E)}function l(x){let w=i.createBuffer(),y=x.__size,S=x.usage;return i.bindBuffer(i.UNIFORM_BUFFER,w),i.bufferData(i.UNIFORM_BUFFER,y,S),i.bindBuffer(i.UNIFORM_BUFFER,null),w}function c(x){let w=s[x.id],y=x.uniforms,S=x.__cache;i.bindBuffer(i.UNIFORM_BUFFER,w);for(let E=0,_=y.length;E<_;E++){let A=y[E];if(Array.isArray(A))for(let k=0,R=A.length;k<R;k++)h(A[k],E,k,S);else h(A,E,0,S)}i.bindBuffer(i.UNIFORM_BUFFER,null)}function h(x,w,y,S){if(d(x,w,y,S)===!0){let E=x.__offset,_=x.value;if(Array.isArray(_)){let A=0;for(let k=0;k<_.length;k++){let R=_[k],D=b(R,!0);u(R,x.__data,A),A+=D.storage/Float32Array.BYTES_PER_ELEMENT}}else u(_,x.__data,0);i.bufferSubData(i.UNIFORM_BUFFER,E,x.__data)}}function u(x,w,y){typeof x=="number"||typeof x=="boolean"?w[y]=x:x.isMatrix3?(w[y]=x.elements[0],w[y+1]=x.elements[1],w[y+2]=x.elements[2],w[y+3]=0,w[y+4]=x.elements[3],w[y+5]=x.elements[4],w[y+6]=x.elements[5],w[y+7]=0,w[y+8]=x.elements[6],w[y+9]=x.elements[7],w[y+10]=x.elements[8],w[y+11]=0):ArrayBuffer.isView(x)?w.set(x.subarray(0,w.length-y),y):x.toArray(w,y)}function d(x,w,y,S){let E=x.value,_=w+"_"+y;if(Array.isArray(E)){S[_]===void 0&&(S[_]=[]);let A=S[_],k=!1;for(let R=0;R<E.length;R++)f(E[R],A,R)===!0&&(k=!0);return k}return f(E,S,_)}function f(x,w,y){if(w[y]===void 0)return typeof x=="number"||typeof x=="boolean"?w[y]=x:ArrayBuffer.isView(x)?w[y]=x.slice():w[y]=x.clone(),!0;{let S=w[y];if(typeof x=="number"||typeof x=="boolean"){if(S!==x)return w[y]=x,!0}else{if(ArrayBuffer.isView(x))return!0;if(S.equals(x)===!1)return S.copy(x),!0}}return!1}function m(x){let w=x.uniforms,y=0,S=16;for(let _=0,A=w.length;_<A;_++){let k=Array.isArray(w[_])?w[_]:[w[_]];for(let R=0,D=k.length;R<D;R++){let B=k[R],W=Array.isArray(B.value)?B.value:[B.value],I=Array.isArray(w[_])||Array.isArray(B.value),G=y;for(let z=0,te=W.length;z<te;z++){let q=W[z],Z=b(q,I),Q=y%S,we=Q%Z.boundary,Fe=Q+we;y+=we,Fe!==0&&S-Fe<Z.storage&&(y+=S-Fe),z===0&&(G=y),y+=Z.storage}let j=B.type==="int"?Int32Array:B.type==="uint"?Uint32Array:Float32Array;B.__data=new j((y-G)/Float32Array.BYTES_PER_ELEMENT),B.__offset=G}}let E=y%S;return E>0&&(y+=S-E),x.__size=y,x.__cache={},this}function b(x,w){let y={boundary:0,storage:0};return typeof x=="number"||typeof x=="boolean"?(y.boundary=4,y.storage=4):x.isVector2?(y.boundary=8,y.storage=8):x.isVector3||x.isColor?(y.boundary=16,y.storage=12):x.isVector4?(y.boundary=16,y.storage=16):x.isMatrix3?(y.boundary=16,y.storage=48):x.isMatrix4?(y.boundary=16,y.storage=64):x.isTexture?Se("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(x)?(y.boundary=16,y.storage=x.byteLength):Se("WebGLRenderer: Unsupported uniform value type.",x),w===!0&&(y.boundary=16,y.storage=Math.ceil(y.storage/16)*16),y}function g(x){let w=x.target;w.removeEventListener("dispose",g),i.deleteBuffer(s[w.id]),delete s[w.id],delete r[w.id]}function p(){for(let x in s)i.deleteBuffer(s[x]);s={},r={}}return{bind:a,update:o,dispose:p}}function $v(){return ei===null&&(ei=new Zs(Jv,16,16,Bi,Hn),ei.name="DFG_LUT",ei.minFilter=St,ei.magFilter=St,ei.wrapS=wn,ei.wrapT=wn,ei.generateMipmaps=!1,ei.needsUpdate=!0),ei}var p_,m_,g_,__,b_,x_,y_,v_,w_,M_,S_,A_,E_,T_,R_,C_,L_,P_,I_,k_,D_,N_,F_,U_,O_,B_,H_,z_,G_,V_,W_,q_,X_,j_,Y_,K_,J_,$_,Z_,Q_,eb,tb,nb,ib,sb,rb,ab,ob,lb,cb,hb,ub,db,fb,pb,mb,gb,_b,bb,xb,yb,vb,wb,Mb,Sb,Ab,Eb,Tb,Rb,Cb,Lb,Pb,Ib,kb,Db,Nb,Fb,Ub,Ob,Bb,Hb,zb,Gb,Vb,Wb,qb,Xb,jb,Yb,Kb,Jb,$b,Zb,Qb,ex,tx,nx,ix,sx,rx,ax,ox,lx,cx,hx,ux,dx,fx,px,mx,gx,_x,bx,xx,yx,vx,wx,Mx,Sx,Ax,Ex,Tx,Rx,Cx,Lx,Px,Ix,kx,Dx,Nx,Fx,Ux,Ox,Bx,Hx,zx,Gx,Vx,Wx,qx,Xx,ze,fe,ti,Ml,jx,fp,ga,qf,Qx,ey,pp,mp,ty,ny,iy,Al,py,gp,_p,bp,xp,yp,vp,Kf,Jf,$f,Zf,Qf,Oh,Bh,Hh,Fh,dr,iv,sv,np,lv,Sl,pv,gv,bv,yv,wv,Av,Gh,Vh,kv,Uv,Ov,Bv,Hv,up,pa,Uh,qv,Xv,Wh,qh,jv,wp,Jv,ei,gs,at=rt(()=>{Nh();Nh();p_=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,m_=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,g_=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,__=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,b_=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,x_=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,y_=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,v_=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,w_=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec4 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
	}
#endif`,M_=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,S_=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,A_=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,E_=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,T_=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,R_=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,C_=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,L_=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,P_=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,I_=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,k_=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,D_=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,N_=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,F_=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= instanceColor.rgb;
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`,U_=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
#define inverseTransformDirection transformDirectionByInverseViewMatrix
vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	return normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
}
vec3 transformDirectionByInverseViewMatrix( in vec3 dir, in mat4 viewMatrix ) {
	return normalize( ( vec4( dir, 0.0 ) * viewMatrix ).xyz );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,O_=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
#endif`,B_=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,H_=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,z_=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,G_=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,V_="gl_FragColor = linearToOutputTexel( gl_FragColor );",W_=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,q_=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * reflectVec );
		#ifdef ENVMAP_BLENDING_MULTIPLY
			outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_MIX )
			outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_ADD )
			outgoingLight += envColor.xyz * specularStrength * reflectivity;
		#endif
	#endif
#endif`,X_=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	uniform samplerCube envMap;
	#ifdef ENVMAP_TYPE_PMREM
		float roughnessToMip( const in float roughness ) {
			float r = clamp( roughness, 0.0, 1.0 );
			return ENVMAP_MAX_LOD * r * ( 2.0 - r );
		}
	#endif
#endif`,j_=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,Y_=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,K_=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,J_=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,$_=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,Z_=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,Q_=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,eb=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,tb=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,nb=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,ib=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,sb=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_SUN_LIGHTS > 0
	struct SunLight {
		vec3 direction;
		vec3 color;
	};
	uniform SunLight sunLights[ NUM_SUN_LIGHTS ];
	void getSunLightInfo( const in SunLight sunLight, out IncidentLight light ) {
		light.color = sunLight.color;
		light.direction = sunLight.direction;
		light.visible = true;
	}
#endif
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif
#include <lightprobes_pars_fragment>`,rb=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_PMREM
			vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
			vec4 envMapColor = textureLod( envMap, envMapRotation * worldNormal, ENVMAP_MAX_LOD );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_PMREM
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
			vec4 envMapColor = textureLod( envMap, envMapRotation * reflectVec, roughnessToMip( roughness ) );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_RETROREFLECTION
		vec3 getIBLRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
			#ifdef ENVMAP_TYPE_PMREM
				vec3 retroVec = normalize( mix( viewDir, normal, pow4( roughness ) ) );
				retroVec = transformDirectionByInverseViewMatrix( retroVec, viewMatrix );
				vec4 envMapColor = textureLod( envMap, envMapRotation * retroVec, roughnessToMip( roughness ) );
				return envMapColor.rgb * envMapIntensity;
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_PMREM
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
		#ifdef USE_RETROREFLECTION
			vec3 getIBLAnisotropyRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
				#ifdef ENVMAP_TYPE_PMREM
					vec3 bentNormal = cross( bitangent, viewDir );
					bentNormal = normalize( cross( bentNormal, bitangent ) );
					bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
					return getIBLRetroRadiance( viewDir, bentNormal, roughness );
				#else
					return vec3( 0.0 );
				#endif
			}
		#endif
	#endif
#endif`,ab=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,ob=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,lb=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,cb=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,hb=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.045 );
material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef USE_DIFFUSE_ROUGHNESS
	float diffuseRoughnessFactor = diffuseRoughness;
	#ifdef USE_DIFFUSE_ROUGHNESSMAP
		diffuseRoughnessFactor *= texture2D( diffuseRoughnessMap, vDiffuseRoughnessMapUv ).r;
	#endif
	material.diffuseRoughness = saturate( diffuseRoughnessFactor );
#endif
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = vec3( 0.04 );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.045 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_RETROREFLECTION
	material.retroreflectivity = retroreflectivity;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,ub=`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
	vec2 dfg;
	vec3 multiScatteringCompensation;
	#ifdef USE_DIFFUSE_ROUGHNESS
		float diffuseRoughness;
	#endif
	#ifdef USE_RETROREFLECTION
		float retroreflectivity;
	#endif
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0Dielectric;
		vec3 iridescenceF0Metallic;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
#ifdef USE_DIFFUSE_ROUGHNESS
	const float EON_EPSILON = 1e-7;
	float FON_DirectionalAlbedo( const in float mu, const in float roughness, const in float A ) {
		float muComp = 1.0 - mu;
		float gOverPi = muComp * ( 0.0571085289 + muComp * ( 0.491881867 + muComp * ( - 0.332181442 + muComp * 0.0714429953 ) ) );
		return A * ( 1.0 + roughness * gOverPi );
	}
	vec3 BRDF_EON( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 diffuseColor, const in float roughness ) {
		vec3 rho = saturate( diffuseColor );
		if ( roughness <= EON_EPSILON ) return BRDF_Lambert( rho );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float s = dot( lightDir, viewDir ) - dotNL * dotNV;
		float sOverT = ( s > 0.0 ) ? s / max( max( dotNL, dotNV ), EON_EPSILON ) : s;
		float A = 1.0 / ( 1.0 + ( 0.5 - 2.0 / ( 3.0 * PI ) ) * roughness );
		vec3 singleScatter = rho * RECIPROCAL_PI * A * ( 1.0 + roughness * sOverT );
		float averageAlbedo = A * ( 1.0 + ( 2.0 / 3.0 - 28.0 / ( 15.0 * PI ) ) * roughness );
		float albedoV = FON_DirectionalAlbedo( dotNV, roughness, A );
		float albedoL = FON_DirectionalAlbedo( dotNL, roughness, A );
		vec3 rhoMultiScatter = rho * rho * averageAlbedo / max( vec3( EON_EPSILON ), vec3( 1.0 ) - rho * ( 1.0 - averageAlbedo ) );
		vec3 multiScatter = rhoMultiScatter * RECIPROCAL_PI
			* max( EON_EPSILON, 1.0 - albedoV )
			* max( EON_EPSILON, 1.0 - albedoL )
			/ max( EON_EPSILON, 1.0 - averageAlbedo );
		return singleScatter + multiScatter;
	}
	vec3 EON_DirectionalAlbedo( const in vec3 diffuseColor, const in float roughness, const in float dotNV ) {
		vec3 rho = saturate( diffuseColor );
		if ( roughness <= EON_EPSILON ) return rho;
		float A = 1.0 / ( 1.0 + ( 0.5 - 2.0 / ( 3.0 * PI ) ) * roughness );
		float directionalAlbedo = FON_DirectionalAlbedo( dotNV, roughness, A );
		float averageAlbedo = A * ( 1.0 + ( 2.0 / 3.0 - 28.0 / ( 15.0 * PI ) ) * roughness );
		vec3 rhoMultiScatter = rho * rho * averageAlbedo / max( vec3( EON_EPSILON ), vec3( 1.0 ) - rho * ( 1.0 - averageAlbedo ) );
		return rho * directionalAlbedo + rhoMultiScatter * ( 1.0 - directionalAlbedo );
	}
#endif
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		return 0.5 / max( gv + gl, EPSILON );
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = max( material.clearcoatRoughness, 0.045 );
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColorBlended;
	float f90 = material.specularF90;
	float roughness = max( material.roughness, 0.045 );
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float alphaT = max( material.alphaT, alpha );
		float V = V_GGX_SmithCorrelated_Anisotropic( alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float rInv = 1.0 / ( roughness + 0.1 );
	float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
	float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
	float DG = exp( a * dotNV + b );
	return saturate( DG );
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec2 fab, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec2 fab, const in vec3 specularColor, const in float specularF90, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		#ifdef USE_CLEARCOAT
			vec3 Ncc = geometryClearcoatNormal;
			vec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );
			vec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );
			vec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );
			mat3 mInvClearcoat = mat3(
				vec3( t1Clearcoat.x, 0, t1Clearcoat.y ),
				vec3(             0, 1,             0 ),
				vec3( t1Clearcoat.z, 0, t1Clearcoat.w )
			);
			vec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;
			clearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );
		#endif
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
 
 		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
 
 		float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
 		float sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );
 
 		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
 
 		irradiance *= sheenEnergyComp;
 
 	#endif
	vec3 specularBRDF = BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	#ifdef USE_RETROREFLECTION
		vec3 retroViewDir = reflect( - geometryViewDir, geometryNormal );
		vec3 retroSpecularBRDF = BRDF_GGX( directLight.direction, retroViewDir, geometryNormal, material );
		specularBRDF = mix( specularBRDF, retroSpecularBRDF, saturate( material.retroreflectivity ) );
	#endif
	reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;
	vec3 halfDir = normalize( directLight.direction + geometryViewDir );
	float dotVH = saturate( dot( geometryViewDir, halfDir ) );
	vec3 F = F_Schlick( material.specularColor, material.specularF90, dotVH );
	#ifdef USE_RETROREFLECTION
		vec3 retroHalfDir = normalize( directLight.direction + retroViewDir );
		float dotRetroVH = saturate( dot( retroViewDir, retroHalfDir ) );
		vec3 retroF = F_Schlick( material.specularColor, material.specularF90, dotRetroVH );
		F = mix( F, retroF, saturate( material.retroreflectivity ) );
	#endif
	#ifdef USE_DIFFUSE_ROUGHNESS
		vec3 diffuseBRDF = BRDF_EON( directLight.direction, geometryViewDir, geometryNormal, material.diffuseColor, material.diffuseRoughness ) * ( 1.0 - material.metalness );
	#else
		vec3 diffuseBRDF = BRDF_Lambert( material.diffuseContribution );
	#endif
	reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScattering, multiScattering );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScattering, multiScattering );
	#endif
	#ifdef USE_DIFFUSE_ROUGHNESS
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		vec3 diffuseAlbedo = EON_DirectionalAlbedo( material.diffuseColor, material.diffuseRoughness, dotNV ) * ( 1.0 - material.metalness );
		vec3 diffuse = irradiance * RECIPROCAL_PI * diffuseAlbedo * ( 1.0 - singleScattering - multiScattering );
	#else
		vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - singleScattering - multiScattering );
	#endif
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		sheenSpecularIndirect += irradiance * material.sheenColor * sheenAlbedo * RECIPROCAL_PI;
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		diffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectDiffuse += diffuse;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
 	#endif
	vec3 singleScatteringDielectric = vec3( 0.0 );
	vec3 multiScatteringDielectric = vec3( 0.0 );
	vec3 singleScatteringMetallic = vec3( 0.0 );
	vec3 multiScatteringMetallic = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( material.dfg, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceF0Metallic, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( material.dfg, material.diffuseColor, material.specularF90, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	#ifdef USE_DIFFUSE_ROUGHNESS
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		vec3 diffuse = EON_DirectionalAlbedo( material.diffuseColor, material.diffuseRoughness, dotNV ) * ( 1.0 - material.metalness ) * ( 1.0 - totalScatteringDielectric );
	#else
		vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
	#endif
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec3 indirectSpecular = radiance * singleScattering;
	indirectSpecular += multiScattering * cosineWeightedIrradiance;
	vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		indirectSpecular *= sheenEnergyComp;
		indirectDiffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectSpecular += indirectSpecular;
	reflectedLight.indirectDiffuse += indirectDiffuse;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,db=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		vec3 iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		vec3 iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( iridescenceFresnelDielectric, iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0Dielectric = Schlick_to_F0( iridescenceFresnelDielectric, 1.0, dotNVi );
		material.iridescenceF0Metallic = Schlick_to_F0( iridescenceFresnelMetallic, 1.0, dotNVi );
	}
#endif
#ifdef STANDARD
	float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
	material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
	#if ( NUM_SUN_LIGHTS > 0 || NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
		float EssMs = material.dfg.x + material.dfg.y;
		material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
	#endif
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SUN_LIGHTS > 0 ) && defined( RE_Direct )
	SunLight sunLight;
	#if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHTS; i ++ ) {
		sunLight = sunLights[ i ];
		getSunLightInfo( sunLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SUN_LIGHT_SHADOWS )
		sunLightShadow = sunLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getSunShadow( sunShadowMap[ i ], sunLightShadow, UNROLLED_LOOP_INDEX ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_LIGHT_PROBE_GRIDS > 0
		vec3 probeWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 probeWorldNormal = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
		int probeGrid = - 1;
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_LIGHT_PROBE_GRIDS; i ++ ) {
			if ( isInsideLightProbeGrid( probeWorldPos, probeWorldNormal, probesMin[ i ], probesMax[ i ], probesResolution[ i ] ) ) probeGrid = UNROLLED_LOOP_INDEX;
		}
		#pragma unroll_loop_end
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_LIGHT_PROBE_GRIDS; i ++ ) {
			if ( probeGrid == UNROLLED_LOOP_INDEX ) irradiance += getLightProbeGridIrradiance( probesSH[ i ], probesMin[ i ], probesMax[ i ], probesResolution[ i ], probeWorldPos, probeWorldNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,fb=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		vec3 iblRadiance = getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_RETROREFLECTION
		#ifdef USE_ANISOTROPY
			vec3 retroIBLRadiance = getIBLAnisotropyRetroRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
		#else
			vec3 retroIBLRadiance = getIBLRetroRadiance( geometryViewDir, geometryNormal, material.roughness );
		#endif
		iblRadiance = mix( iblRadiance, retroIBLRadiance, saturate( material.retroreflectivity ) );
	#endif
	radiance += iblRadiance;
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,pb=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,mb=`#if NUM_LIGHT_PROBE_GRIDS > 0
uniform highp sampler3D probesSH[ NUM_LIGHT_PROBE_GRIDS ];
uniform vec3 probesMin[ NUM_LIGHT_PROBE_GRIDS ];
uniform vec3 probesMax[ NUM_LIGHT_PROBE_GRIDS ];
uniform vec3 probesResolution[ NUM_LIGHT_PROBE_GRIDS ];
bool isInsideLightProbeGrid( vec3 worldPos, vec3 worldNormal, vec3 probesMin, vec3 probesMax, vec3 probesResolution ) {
	vec3 spacing = ( probesMax - probesMin ) / probesResolution;
	vec3 samplePos = worldPos + worldNormal * spacing * 0.5;
	vec3 margin = spacing * 0.01;
	return all( greaterThanEqual( samplePos, probesMin - margin ) ) && all( lessThanEqual( samplePos, probesMax + margin ) );
}
vec3 getLightProbeGridIrradiance( highp sampler3D probesSH, vec3 probesMin, vec3 probesMax, vec3 probesResolution, vec3 worldPos, vec3 worldNormal ) {
	vec3 res = probesResolution;
	vec3 gridRange = probesMax - probesMin;
	vec3 probeSpacing = gridRange / res;
	vec3 samplePos = worldPos + worldNormal * probeSpacing * 0.5;
	vec3 uvw = clamp( ( samplePos - probesMin ) / gridRange, 0.5 / res, 1.0 - 0.5 / res );
	float nz          = res.z;
	float paddedSlices = nz + 2.0;
	float atlasDepth  = 7.0 * paddedSlices;
	float uvZBase     = uvw.z * nz + 1.0;
	vec4 s0 = texture( probesSH, vec3( uvw.xy, ( uvZBase                       ) / atlasDepth ) );
	vec4 s1 = texture( probesSH, vec3( uvw.xy, ( uvZBase +       paddedSlices   ) / atlasDepth ) );
	vec4 s2 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 2.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s3 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 3.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s4 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 4.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s5 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 5.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s6 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 6.0 * paddedSlices   ) / atlasDepth ) );
	vec3 c0 = s0.xyz;
	vec3 c1 = vec3( s0.w, s1.xy );
	vec3 c2 = vec3( s1.zw, s2.x );
	vec3 c3 = s2.yzw;
	vec3 c4 = s3.xyz;
	vec3 c5 = vec3( s3.w, s4.xy );
	vec3 c6 = vec3( s4.zw, s5.x );
	vec3 c7 = s5.yzw;
	vec3 c8 = s6.xyz;
	float x = worldNormal.x, y = worldNormal.y, z = worldNormal.z;
	vec3 result = c0 * 0.886227;
	result += c1 * 2.0 * 0.511664 * y;
	result += c2 * 2.0 * 0.511664 * z;
	result += c3 * 2.0 * 0.511664 * x;
	result += c4 * 2.0 * 0.429043 * x * y;
	result += c5 * 2.0 * 0.429043 * y * z;
	result += c6 * ( 0.743125 * z * z - 0.247708 );
	result += c7 * 2.0 * 0.429043 * x * z;
	result += c8 * 0.429043 * ( x * x - y * y );
	return max( result, vec3( 0.0 ) );
}
#endif`,gb=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,_b=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,bb=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,xb=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,yb=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,vb=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,wb=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,Mb=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Sb=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,Ab=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,Eb=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,Tb=`#if defined( USE_MORPHCOLORS )
	#if defined( USE_COLOR_ALPHA )
		vColor *= morphTargetBaseInfluence;
	#elif defined( USE_COLOR )
		vColor.rgb *= morphTargetBaseInfluence;
	#endif
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor.rgb += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,Rb=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Cb=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,Lb=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Pb=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#ifdef DOUBLE_SIDED
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#ifdef DOUBLE_SIDED
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,Ib=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,kb=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Db=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Nb=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`,Fb=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,Ub=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,Ob=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,Bb=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,Hb=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,zb=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,Gb=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	#ifdef USE_REVERSED_DEPTH_BUFFER
	
		return depth * ( far - near ) - far;
	#else
		return depth * ( near - far ) - near;
	#endif
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	
	#ifdef USE_REVERSED_DEPTH_BUFFER
		return ( near * far ) / ( ( near - far ) * depth - near );
	#else
		return ( near * far ) / ( ( far - near ) * depth - far );
	#endif
}`,Vb=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,Wb=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,qb=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,Xb=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,jb=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,Yb=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,Kb=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		#define SUN_LIGHT_CASCADES 2
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#else
			uniform sampler2D sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#endif
		uniform mat4 sunShadowMatrix[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		uniform vec4 sunShadowCascade[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
		struct SunLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SunLightShadow sunLightShadows[ NUM_SUN_LIGHT_SHADOWS ];
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#else
			uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#endif
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#else
			uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#endif
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#elif defined( SHADOWMAP_TYPE_BASIC )
			uniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#endif
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				vec2 radius = shadowRadius * texelSize;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#elif defined( SHADOWMAP_TYPE_VSM )
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
				float mean = distribution.x;
				float variance = distribution.y * distribution.y;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float hard_shadow = step( mean, shadowCoord.z );
				#else
					float hard_shadow = step( shadowCoord.z, mean );
				#endif
				
				if ( hard_shadow == 1.0 ) {
					shadow = 1.0;
				} else {
					variance = max( variance, 0.0000001 );
					float d = shadowCoord.z - mean;
					float p_max = variance / ( variance + d * d );
					p_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
					shadow = max( hard_shadow, p_max );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#else
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float depth = texture2D( shadowMap, shadowCoord.xy ).r;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					shadow = step( depth, shadowCoord.z );
				#else
					shadow = step( shadowCoord.z, depth );
				#endif
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
	#if NUM_SUN_LIGHT_SHADOWS > 0
		float getSunShadow(
			#if defined( SHADOWMAP_TYPE_PCF )
				sampler2DShadow shadowMap,
			#else
				sampler2D shadowMap,
			#endif
			SunLightShadow sunLightShadow,
			int shadowIndex
		) {
			vec4 shadowWorldPosition = vec4( vSunShadowWorldPosition.xyz + vSunShadowWorldNormal * sunLightShadow.shadowNormalBias, 1.0 );
			float viewDepth = vSunShadowWorldPosition.w;
			int cascadeOffset = shadowIndex * SUN_LIGHT_CASCADES;
			float shadow = 1.0;
			for ( int i = SUN_LIGHT_CASCADES - 1; i >= 0; i -- ) {
				vec4 cascade = sunShadowCascade[ cascadeOffset + i ];
				if ( viewDepth >= cascade.x && viewDepth < cascade.y ) {
					float cascadeShadow = getShadow(
						shadowMap,
						sunLightShadow.shadowMapSize,
						sunLightShadow.shadowIntensity,
						sunLightShadow.shadowBias,
						sunLightShadow.shadowRadius,
						sunShadowMatrix[ cascadeOffset + i ] * shadowWorldPosition
					);
					shadow = mix( cascadeShadow, shadow, smoothstep( cascade.z, cascade.y, viewDepth ) );
				}
			}
			return shadow;
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float lightDistance = length( lightToPosition );
			float depthRange = shadowCameraFar - shadowCameraNear;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float depthA = - shadowCameraNear / depthRange - shadowBias;
				float depthB = shadowCameraNear * shadowCameraFar / ( depthRange * lightDistance );
			#else
				float depthA = shadowCameraFar / depthRange + shadowBias;
				float depthB = - shadowCameraNear * shadowCameraFar / ( depthRange * lightDistance );
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			shadow = 0.0;
			for ( int i = 0; i < 5; i ++ ) {
				vec2 offset = vogelDiskSample( i, 5, phi );
				vec3 direction = bd3D + ( tangent * offset.x + bitangent * offset.y ) * texelSize;
				vec3 absDirection = abs( direction );
				float dp = depthA + depthB / max( max( absDirection.x, absDirection.y ), absDirection.z );
				shadow += texture( shadowMap, vec4( direction, dp ) );
			}
			shadow *= 0.2;
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#elif defined( SHADOWMAP_TYPE_BASIC )
	float getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			float depth = textureCube( shadowMap, bd3D ).r;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				depth = 1.0 - depth;
			#endif
			shadow = step( dp, depth );
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#endif
	#endif
#endif`,Jb=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,$b=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_SUN_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_SUN_LIGHT_SHADOWS > 0
		vSunShadowWorldPosition = vec4( worldPosition.xyz, - mvPosition.z );
		vSunShadowWorldNormal = shadowWorldNormal;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,Zb=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHT_SHADOWS; i ++ ) {
		sunLight = sunLightShadows[ i ];
		shadow *= receiveShadow ? getSunShadow( sunShadowMap[ i ], sunLight, UNROLLED_LOOP_INDEX ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,Qb=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,ex=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,tx=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,nx=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,ix=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,sx=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,rx=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,ax=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,ox=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,lx=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,cx=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_DIFFUSE_ROUGHNESSMAP
	varying vec2 vDiffuseRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,hx=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_DIFFUSE_ROUGHNESSMAP
	uniform mat3 diffuseRoughnessMapTransform;
	varying vec2 vDiffuseRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,ux=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DIFFUSE_ROUGHNESSMAP
	vDiffuseRoughnessMapUv = ( diffuseRoughnessMapTransform * vec3( DIFFUSE_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,dx=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,fx=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,px=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,mx=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,gx=`uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <envmap_common_pars_fragment>
void main() {
	#ifdef ENVMAP_TYPE_PMREM
		vec4 texColor = textureLod( envMap, backgroundRotation * vWorldDirection, roughnessToMip( backgroundBlurriness ) );
	#else
		vec4 texColor = textureCube( envMap, backgroundRotation * vWorldDirection );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,_x=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,bx=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,xx=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,yx=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,vx=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,wx=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
}`,Mx=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Sx=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Ax=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Ex=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Tx=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,Rx=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Cx=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Lx=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Px=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,Ix=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,kx=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,Dx=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,Nx=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Fx=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Ux=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,Ox=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DIFFUSE_ROUGHNESS
	uniform float diffuseRoughness;
	#ifdef USE_DIFFUSE_ROUGHNESSMAP
		uniform sampler2D diffuseRoughnessMap;
	#endif
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_RETROREFLECTION
	uniform float retroreflectivity;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
 
		outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
 
 	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Bx=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Hx=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,zx=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,Gx=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Vx=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Wx=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,qx=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Xx=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,ze={alphahash_fragment:p_,alphahash_pars_fragment:m_,alphamap_fragment:g_,alphamap_pars_fragment:__,alphatest_fragment:b_,alphatest_pars_fragment:x_,aomap_fragment:y_,aomap_pars_fragment:v_,batching_pars_vertex:w_,batching_vertex:M_,begin_vertex:S_,beginnormal_vertex:A_,bsdfs:E_,iridescence_fragment:T_,bumpmap_pars_fragment:R_,clipping_planes_fragment:C_,clipping_planes_pars_fragment:L_,clipping_planes_pars_vertex:P_,clipping_planes_vertex:I_,color_fragment:k_,color_pars_fragment:D_,color_pars_vertex:N_,color_vertex:F_,common:U_,defaultnormal_vertex:O_,displacementmap_pars_vertex:B_,displacementmap_vertex:H_,emissivemap_fragment:z_,emissivemap_pars_fragment:G_,colorspace_fragment:V_,colorspace_pars_fragment:W_,envmap_fragment:q_,envmap_common_pars_fragment:X_,envmap_pars_fragment:j_,envmap_pars_vertex:Y_,envmap_physical_pars_fragment:rb,envmap_vertex:K_,fog_vertex:J_,fog_pars_vertex:$_,fog_fragment:Z_,fog_pars_fragment:Q_,gradientmap_pars_fragment:eb,lightmap_pars_fragment:tb,lights_lambert_fragment:nb,lights_lambert_pars_fragment:ib,lights_pars_begin:sb,lights_toon_fragment:ab,lights_toon_pars_fragment:ob,lights_phong_fragment:lb,lights_phong_pars_fragment:cb,lights_physical_fragment:hb,lights_physical_pars_fragment:ub,lights_fragment_begin:db,lights_fragment_maps:fb,lights_fragment_end:pb,lightprobes_pars_fragment:mb,logdepthbuf_fragment:gb,logdepthbuf_pars_fragment:_b,logdepthbuf_pars_vertex:bb,logdepthbuf_vertex:xb,map_fragment:yb,map_pars_fragment:vb,map_particle_fragment:wb,map_particle_pars_fragment:Mb,metalnessmap_fragment:Sb,metalnessmap_pars_fragment:Ab,morphinstance_vertex:Eb,morphcolor_vertex:Tb,morphnormal_vertex:Rb,morphtarget_pars_vertex:Cb,morphtarget_vertex:Lb,normal_fragment_begin:Pb,normal_fragment_maps:Ib,normal_pars_fragment:kb,normal_pars_vertex:Db,normal_vertex:Nb,normalmap_pars_fragment:Fb,clearcoat_normal_fragment_begin:Ub,clearcoat_normal_fragment_maps:Ob,clearcoat_pars_fragment:Bb,iridescence_pars_fragment:Hb,opaque_fragment:zb,packing:Gb,premultiplied_alpha_fragment:Vb,project_vertex:Wb,dithering_fragment:qb,dithering_pars_fragment:Xb,roughnessmap_fragment:jb,roughnessmap_pars_fragment:Yb,shadowmap_pars_fragment:Kb,shadowmap_pars_vertex:Jb,shadowmap_vertex:$b,shadowmask_pars_fragment:Zb,skinbase_vertex:Qb,skinning_pars_vertex:ex,skinning_vertex:tx,skinnormal_vertex:nx,specularmap_fragment:ix,specularmap_pars_fragment:sx,tonemapping_fragment:rx,tonemapping_pars_fragment:ax,transmission_fragment:ox,transmission_pars_fragment:lx,uv_pars_fragment:cx,uv_pars_vertex:hx,uv_vertex:ux,worldpos_vertex:dx,background_vert:fx,background_frag:px,backgroundCube_vert:mx,backgroundCube_frag:gx,cube_vert:_x,cube_frag:bx,depth_vert:xx,depth_frag:yx,distance_vert:vx,distance_frag:wx,equirect_vert:Mx,equirect_frag:Sx,linedashed_vert:Ax,linedashed_frag:Ex,meshbasic_vert:Tx,meshbasic_frag:Rx,meshlambert_vert:Cx,meshlambert_frag:Lx,meshmatcap_vert:Px,meshmatcap_frag:Ix,meshnormal_vert:kx,meshnormal_frag:Dx,meshphong_vert:Nx,meshphong_frag:Fx,meshphysical_vert:Ux,meshphysical_frag:Ox,meshtoon_vert:Bx,meshtoon_frag:Hx,points_vert:zx,points_frag:Gx,shadow_vert:Vx,shadow_frag:Wx,sprite_vert:qx,sprite_frag:Xx},fe={common:{diffuse:{value:new Ee(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new De},alphaMap:{value:null},alphaMapTransform:{value:new De},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new De}},envmap:{envMap:{value:null},envMapRotation:{value:new De},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new De}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new De}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new De},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new De},normalScale:{value:new Ie(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new De},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new De}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new De}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new De}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Ee(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},sunLights:{value:[],properties:{direction:{},color:{}}},sunLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},sunShadowMatrix:{value:[]},sunShadowCascade:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:[]},probesMin:{value:[]},probesMax:{value:[]},probesResolution:{value:[]}},points:{diffuse:{value:new Ee(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new De},alphaTest:{value:0},uvTransform:{value:new De}},sprite:{diffuse:{value:new Ee(16777215)},opacity:{value:1},center:{value:new Ie(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new De},alphaMap:{value:null},alphaMapTransform:{value:new De},alphaTest:{value:0}}},ti={basic:{uniforms:Xt([fe.common,fe.specularmap,fe.envmap,fe.aomap,fe.lightmap,fe.fog]),vertexShader:ze.meshbasic_vert,fragmentShader:ze.meshbasic_frag},lambert:{uniforms:Xt([fe.common,fe.specularmap,fe.envmap,fe.aomap,fe.lightmap,fe.emissivemap,fe.bumpmap,fe.normalmap,fe.displacementmap,fe.fog,fe.lights,{emissive:{value:new Ee(0)},envMapIntensity:{value:1}}]),vertexShader:ze.meshlambert_vert,fragmentShader:ze.meshlambert_frag},phong:{uniforms:Xt([fe.common,fe.specularmap,fe.envmap,fe.aomap,fe.lightmap,fe.emissivemap,fe.bumpmap,fe.normalmap,fe.displacementmap,fe.fog,fe.lights,{emissive:{value:new Ee(0)},specular:{value:new Ee(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:ze.meshphong_vert,fragmentShader:ze.meshphong_frag},standard:{uniforms:Xt([fe.common,fe.envmap,fe.aomap,fe.lightmap,fe.emissivemap,fe.bumpmap,fe.normalmap,fe.displacementmap,fe.roughnessmap,fe.metalnessmap,fe.fog,fe.lights,{emissive:{value:new Ee(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:ze.meshphysical_vert,fragmentShader:ze.meshphysical_frag},toon:{uniforms:Xt([fe.common,fe.aomap,fe.lightmap,fe.emissivemap,fe.bumpmap,fe.normalmap,fe.displacementmap,fe.gradientmap,fe.fog,fe.lights,{emissive:{value:new Ee(0)}}]),vertexShader:ze.meshtoon_vert,fragmentShader:ze.meshtoon_frag},matcap:{uniforms:Xt([fe.common,fe.bumpmap,fe.normalmap,fe.displacementmap,fe.fog,{matcap:{value:null}}]),vertexShader:ze.meshmatcap_vert,fragmentShader:ze.meshmatcap_frag},points:{uniforms:Xt([fe.points,fe.fog]),vertexShader:ze.points_vert,fragmentShader:ze.points_frag},dashed:{uniforms:Xt([fe.common,fe.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:ze.linedashed_vert,fragmentShader:ze.linedashed_frag},depth:{uniforms:Xt([fe.common,fe.displacementmap]),vertexShader:ze.depth_vert,fragmentShader:ze.depth_frag},normal:{uniforms:Xt([fe.common,fe.bumpmap,fe.normalmap,fe.displacementmap,{opacity:{value:1}}]),vertexShader:ze.meshnormal_vert,fragmentShader:ze.meshnormal_frag},sprite:{uniforms:Xt([fe.sprite,fe.fog]),vertexShader:ze.sprite_vert,fragmentShader:ze.sprite_frag},background:{uniforms:{uvTransform:{value:new De},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:ze.background_vert,fragmentShader:ze.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new De}},vertexShader:ze.backgroundCube_vert,fragmentShader:ze.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:ze.cube_vert,fragmentShader:ze.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:ze.equirect_vert,fragmentShader:ze.equirect_frag},distance:{uniforms:Xt([fe.common,fe.displacementmap,{referencePosition:{value:new L},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:ze.distance_vert,fragmentShader:ze.distance_frag},shadow:{uniforms:Xt([fe.lights,fe.fog,{color:{value:new Ee(0)},opacity:{value:1}}]),vertexShader:ze.shadow_vert,fragmentShader:ze.shadow_frag}};ti.physical={uniforms:Xt([ti.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new De},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new De},clearcoatNormalScale:{value:new Ie(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new De},diffuseRoughness:{value:0},diffuseRoughnessMap:{value:null},diffuseRoughnessMapTransform:{value:new De},dispersion:{value:0},retroreflectivity:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new De},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new De},sheen:{value:0},sheenColor:{value:new Ee(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new De},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new De},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new De},transmissionSamplerSize:{value:new Ie},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new De},attenuationDistance:{value:0},attenuationColor:{value:new Ee(0)},specularColor:{value:new Ee(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new De},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new De},anisotropyVector:{value:new Ie},anisotropyMap:{value:null},anisotropyMapTransform:{value:new De}}]),vertexShader:ze.meshphysical_vert,fragmentShader:ze.meshphysical_frag};Ml={r:0,b:0,g:0},jx=new ke,fp=new De;fp.set(-1,0,0,0,1,0,0,0,1);ga=class extends dn{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let n={width:e,height:e,depth:1},s=[n,n,n,n,n,n];this.texture=new Xr(s),this._setTextureOptions(t),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},s=new tr(5,5,5),r=new Xn({name:"CubemapFromEquirect",uniforms:ms(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:en,blending:cs});r.uniforms.tEquirect.value=t;let a=new Bt(s,r),o=t.minFilter;return t.minFilter===An&&(t.minFilter=St),new sr(1,10,this).update(e,a),t.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(e,t=!0,n=!0,s=!0){let r=e.getRenderTarget();for(let a=0;a<6;a++)e.setRenderTarget(this,a),e.clear(t,n,s);e.setRenderTarget(r)}},qf=256,Qx=3,ey=20,pp=256,mp=16,ty=3,ny=new L,iy=new Ee,Al=class i{constructor(e){this._renderer=e,this._cubeSize=0,this._sourceTarget=null,this._cubeCamera=new sr(1,10,null),this._boxMesh=new Bt(new tr(5,5,5),null),this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null,this._integrationMaterial=null}fromScene(e,t=0,n=.1,s=100,r={}){let{size:a=256,position:o=ny}=r,l=this._renderer;this._setSize(a);let c=this._allocateTarget(),h=this._getSourceTarget(!0);t>0&&(h.texture.mipmapsAutoUpdate=!1);let u=l.autoClear,d=l.autoClearColor,f=l.autoClearDepth,m=l.autoClearStencil,b=e.background;l.autoClear=!0,l.autoClearColor=!0,l.autoClearDepth=!0,l.autoClearStencil=!0,b===null&&(e.background=l.getClearColor(iy));let g=new sr(n,s,h);return g.position.copy(o),g.update(l,e),l.autoClear=u,l.autoClearColor=d,l.autoClearDepth=f,l.autoClearStencil=m,e.background=b,t>0&&(h.texture.mipmapsAutoUpdate=!0,this._blur(c,t)),this._applyPMREM(c),c}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Yf(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=jf(),this._compileMaterial(this._equirectMaterial))}dispose(){this._sourceTarget!==null&&this._sourceTarget.dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._integrationMaterial!==null&&this._integrationMaterial.dispose(),this._boxMesh.geometry.dispose()}static lodToRoughness(e,t){return t>0?1-Math.sqrt(1-e/t):0}_setSize(e){this._cubeSize=Math.max(qf,Mh(e))}_fromTexture(e,t){e.mapping===us||e.mapping===lr?this._setSize(e.image.length===0?qf:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4);let n=t||this._allocateTarget();return this._textureToCubemap(e),this._applyPMREM(n),n}_allocateTarget(){let e=this._cubeSize,t=Xf(e,!1,!1),n=Math.log2(e)-Qx;for(let s=0;s<=n;s++)t.texture.mipmaps.push({width:e>>s,height:e>>s});return t.texture.name="PMREM",t.texture.isPMREMTexture=!0,t}_getSourceTarget(e=!1){let t=this._cubeSize,n=this._sourceTarget;return(n===null||n.width!==t||e&&n.depthBuffer===!1)&&(n!==null&&n.dispose(),this._sourceTarget=Xf(t,!0,e)),this._sourceTarget}_compileMaterial(e){this._boxMesh.material=e,this._renderer.compile(this._boxMesh,this._cubeCamera.children[0])}_renderCube(e,t,n){let s=this._boxMesh,r=this._cubeCamera;s.material=n,r.renderTarget=e,r.activeMipmapLevel=t;let a=e.width>>t;e.viewport.set(0,0,a,a),r.update(this._renderer,s),e.viewport.set(0,0,e.width,e.height)}_textureToCubemap(e){let t;e.mapping===us||e.mapping===lr?(this._cubemapMaterial===null&&(this._cubemapMaterial=Yf()),t=this._cubemapMaterial,t.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):(this._equirectMaterial===null&&(this._equirectMaterial=jf()),t=this._equirectMaterial),t.uniforms.envMap.value=e,this._renderCube(this._getSourceTarget(),0,t)}_applyPMREM(e){this._ggxMaterial===null&&(this._ggxMaterial=sy(),this._integrationMaterial=ry());let t=this._cubeSize,n=e.texture.mipmaps.length-1,s=this._ggxMaterial.uniforms;s.envMap.value=this._sourceTarget.texture;let r=this._integrationMaterial.uniforms;r.envMap.value=this._sourceTarget.texture,r.sourceLod.value=Math.log2(t/mp);for(let a=0;a<=n;a++){let o=i.lodToRoughness(a,n);if(a>n-ty)r.roughness.value=o,this._renderCube(e,a,this._integrationMaterial);else{let l=o>0?Math.log2(t)+.5*Math.log2(6/(pp*Math.pow(o,4)))+.5:0;s.roughness.value=o,s.lodBias.value=l,this._renderCube(e,a,this._ggxMaterial)}}}_blur(e,t){this._blurMaterial===null&&(this._blurMaterial=ay());let n=this._blurMaterial,s=n.uniforms,r=this._sourceTarget;s.sigma.value=Math.min(t,Math.PI)/Math.SQRT2,s.envMap.value=r.texture,this._renderCube(e,0,n),s.envMap.value=e.texture,this._renderCube(r,0,n)}};py={[nh]:"LINEAR_TONE_MAPPING",[ih]:"REINHARD_TONE_MAPPING",[sh]:"CINEON_TONE_MAPPING",[rh]:"ACES_FILMIC_TONE_MAPPING",[oh]:"AGX_TONE_MAPPING",[lh]:"NEUTRAL_TONE_MAPPING",[ah]:"CUSTOM_TONE_MAPPING"};gp=new kt,_p=new mi(1,1),bp=new jr(1),xp=new Or,yp=new _o,vp=new Xr,Kf=[],Jf=[],$f=new Float32Array(16),Zf=new Float32Array(9),Qf=new Float32Array(4);Oh=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=Ny(t.type)}},Bh=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=tv(t.type)}},Hh=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){let s=this.seq;for(let r=0,a=s.length;r!==a;++r){let o=s[r];o.setValue(e,t[o.id],n)}}},Fh=/(\w+)(\])?(\[|\.)?/g;dr=class{constructor(e,t){this.seq=[],this.map={};let n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let a=0;a<n;++a){let o=e.getActiveUniform(t,a),l=e.getUniformLocation(t,o.name);nv(o,l,this)}let s=[],r=[];for(let a of this.seq)a.type===e.SAMPLER_2D_SHADOW||a.type===e.SAMPLER_CUBE_SHADOW||a.type===e.SAMPLER_2D_ARRAY_SHADOW?s.push(a):r.push(a);s.length>0&&(this.seq=s.concat(r))}setValue(e,t,n,s){let r=this.map[t];r!==void 0&&r.setValue(e,n,s)}setOptional(e,t,n){let s=t[n];s!==void 0&&this.setValue(e,n,s)}static upload(e,t,n,s){for(let r=0,a=t.length;r!==a;++r){let o=t[r],l=n[o.id];l.needsUpdate!==!1&&o.setValue(e,l.value,s)}}static seqWithValue(e,t){let n=[];for(let s=0,r=e.length;s!==r;++s){let a=e[s];a.id in t&&n.push(a)}return n}};iv=37297,sv=0;np=new De;lv={[nh]:"Linear",[ih]:"Reinhard",[sh]:"Cineon",[rh]:"ACESFilmic",[oh]:"AgX",[lh]:"Neutral",[ah]:"Custom"};Sl=new L;pv=/^[ \t]*#include +<([\w\d./]+)>/gm;gv=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;bv={[ra]:"SHADOWMAP_TYPE_PCF",[ar]:"SHADOWMAP_TYPE_VSM"};yv={[lr]:"ENVMAP_MODE_REFRACTION"};wv={[th]:"ENVMAP_BLENDING_MULTIPLY",[wf]:"ENVMAP_BLENDING_MIX",[Mf]:"ENVMAP_BLENDING_ADD"};Av=0,Gh=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e,t,n){let s=this._getShaderCacheForMaterial(e);return s.has(t)===!1&&(s.add(t),t.usedTimes++),s.has(n)===!1&&(s.add(n),n.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderStage(e){return this._getShaderStage(e.vertexShader)}getFragmentShaderStage(e){return this._getShaderStage(e.fragmentShader)}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){let t=this.shaderCache,n=t.get(e);return n===void 0&&(n=new Vh(e),t.set(e,n)),n}},Vh=class{constructor(e){this.id=Av++,this.code=e,this.usedTimes=0}};kv=0;Uv=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,Ov=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );
	gl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );
}`,Bv=[new L(1,0,0),new L(-1,0,0),new L(0,1,0),new L(0,-1,0),new L(0,0,1),new L(0,0,-1)],Hv=[new L(0,-1,0),new L(0,-1,0),new L(0,0,1),new L(0,0,-1),new L(0,-1,0),new L(0,-1,0)],up=new ke,pa=new L,Uh=new L;qv=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,Xv=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`,Wh=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t){if(this.texture===null){let n=new Yr(e.texture);(e.depthNear!==t.depthNear||e.depthFar!==t.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=n}}getMesh(e){if(this.texture!==null&&this.mesh===null){let t=e.cameras[0].viewport,n=new Xn({vertexShader:qv,fragmentShader:Xv,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new Bt(new Jr(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},qh=class extends Fn{constructor(e,t){super();let n=this,s=null,r=1,a=null,o="local-floor",l=1,c=null,h=null,u=null,d=null,f=null,m=null,b=typeof XRWebGLBinding<"u",g=new Wh,p={},x=t.getContextAttributes(),w=null,y=null,S=[],E=[],_=new Ie,A=null,k=null,R=new Mt;R.viewport=new et;let D=new Mt;D.viewport=new et;let B=[R,D],W=new Lo,I=null,G=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(K){let pe=S[K];return pe===void 0&&(pe=new Ys,S[K]=pe),pe.getTargetRaySpace()},this.getControllerGrip=function(K){let pe=S[K];return pe===void 0&&(pe=new Ys,S[K]=pe),pe.getGripSpace()},this.getHand=function(K){let pe=S[K];return pe===void 0&&(pe=new Ys,S[K]=pe),pe.getHandSpace()};function j(K){let pe=E.indexOf(K.inputSource);if(pe===-1)return;let xe=S[pe];xe!==void 0&&(xe.update(K.inputSource,K.frame,c||a),xe.dispatchEvent({type:K.type,data:K.inputSource}))}function z(){s.removeEventListener("select",j),s.removeEventListener("selectstart",j),s.removeEventListener("selectend",j),s.removeEventListener("squeeze",j),s.removeEventListener("squeezestart",j),s.removeEventListener("squeezeend",j),s.removeEventListener("end",z),s.removeEventListener("inputsourceschange",te);for(let K=0;K<S.length;K++){let pe=E[K];pe!==null&&(E[K]=null,S[K].disconnect(pe))}I=null,G=null,g.reset();for(let K in p)delete p[K];if(e.setRenderTarget(w),f=null,d=null,u=null,s=null,y=null,Fe.stop(),n.isPresenting=!1,e.setPixelRatio(A),e.setSize(_.width,_.height,!1),k!==null){let K=k.camera;K.fov=k.fov,K.zoom=k.zoom,K.updateProjectionMatrix(),k=null}n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(K){r=K,n.isPresenting===!0&&Se("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(K){o=K,n.isPresenting===!0&&Se("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||a},this.setReferenceSpace=function(K){c=K},this.getBaseLayer=function(){return d!==null?d:f},this.getBinding=function(){return u===null&&b&&(u=new XRWebGLBinding(s,t)),u},this.getFrame=function(){return m},this.getSession=function(){return s},this.setSession=async function(K){if(s=K,s!==null){if(w=e.getRenderTarget(),s.addEventListener("select",j),s.addEventListener("selectstart",j),s.addEventListener("selectend",j),s.addEventListener("squeeze",j),s.addEventListener("squeezestart",j),s.addEventListener("squeezeend",j),s.addEventListener("end",z),s.addEventListener("inputsourceschange",te),x.xrCompatible!==!0&&await t.makeXRCompatible(),A=e.getPixelRatio(),e.getSize(_),b&&"createProjectionLayer"in XRWebGLBinding.prototype){let xe=null,Re=null,me=null;x.depth&&(me=x.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,xe=x.stencil?xi:fi,Re=x.stencil?fs:Bn);let Oe={colorFormat:t.RGBA8,depthFormat:me,scaleFactor:r};u=this.getBinding(),d=u.createProjectionLayer(Oe),s.updateRenderState({layers:[d]}),e.setPixelRatio(1),e.setSize(d.textureWidth,d.textureHeight,!1),y=new dn(d.textureWidth,d.textureHeight,{format:En,type:ln,depthTexture:new mi(d.textureWidth,d.textureHeight,Re,void 0,void 0,void 0,void 0,void 0,void 0,xe),stencilBuffer:x.stencil,colorSpace:e.outputColorSpace,samples:x.antialias?4:0,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1,storeMultisampledDepthBuffer:d.ignoreDepthValues===!1,storeMultisampledStencilBuffer:d.ignoreDepthValues===!1})}else{let xe={antialias:x.antialias,alpha:!0,depth:x.depth,stencil:x.stencil,framebufferScaleFactor:r};f=new XRWebGLLayer(s,t,xe),s.updateRenderState({baseLayer:f}),e.setPixelRatio(1),e.setSize(f.framebufferWidth,f.framebufferHeight,!1),y=new dn(f.framebufferWidth,f.framebufferHeight,{format:En,type:ln,colorSpace:e.outputColorSpace,stencilBuffer:x.stencil,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1,storeMultisampledDepthBuffer:f.ignoreDepthValues===!1,storeMultisampledStencilBuffer:f.ignoreDepthValues===!1})}y.isXRRenderTarget=!0,this.setFoveation(l),c=null,a=await s.requestReferenceSpace(o),Fe.setContext(s),Fe.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(s!==null)return s.environmentBlendMode},this.getDepthTexture=function(){return g.getDepthTexture()};function te(K){for(let pe=0;pe<K.removed.length;pe++){let xe=K.removed[pe],Re=E.indexOf(xe);Re>=0&&(E[Re]=null,S[Re].disconnect(xe))}for(let pe=0;pe<K.added.length;pe++){let xe=K.added[pe],Re=E.indexOf(xe);if(Re===-1){for(let Oe=0;Oe<S.length;Oe++)if(Oe>=E.length){E.push(xe),Re=Oe;break}else if(E[Oe]===null){E[Oe]=xe,Re=Oe;break}if(Re===-1)break}let me=S[Re];me&&me.connect(xe)}}function q(K,pe){pe===null?K.matrixWorld.copy(K.matrix):K.matrixWorld.multiplyMatrices(pe.matrixWorld,K.matrix),K.matrixWorldInverse.copy(K.matrixWorld).invert()}this.updateCamera=function(K){if(s===null)return;let pe=K.near,xe=K.far;g.texture!==null&&(g.depthNear>0&&(pe=g.depthNear),g.depthFar>0&&(xe=g.depthFar)),W.near=D.near=R.near=pe,W.far=D.far=R.far=xe,(I!==W.near||G!==W.far)&&(s.updateRenderState({depthNear:W.near,depthFar:W.far}),I=W.near,G=W.far),W.layers.mask=K.layers.mask|6,R.layers.mask=W.layers.mask&-5,D.layers.mask=W.layers.mask&-3;let Re=K.parent,me=W.cameras;q(W,Re);for(let Oe=0;Oe<me.length;Oe++)q(me[Oe],Re);W.projectionMatrix.copy(R.projectionMatrix),W.projectionMatrixInverse.copy(R.projectionMatrixInverse),k===null&&K.isPerspectiveCamera&&(k={camera:K,fov:K.fov,zoom:K.zoom}),Z(K,W,Re)};function Z(K,pe,xe){xe===null?K.matrix.copy(pe.matrixWorld):(K.matrix.copy(xe.matrixWorld),K.matrix.invert(),K.matrix.multiply(pe.matrixWorld)),K.matrix.decompose(K.position,K.quaternion,K.scale),K.updateMatrixWorld(!0),K.projectionMatrix.copy(pe.projectionMatrix),K.projectionMatrixInverse.copy(pe.projectionMatrixInverse),K.isPerspectiveCamera&&(K.fov=ns*2*Math.atan(1/K.projectionMatrix.elements[5]),K.zoom=1)}this.getCamera=function(){return W},this.getFoveation=function(){if(!(d===null&&f===null))return l},this.setFoveation=function(K){l=K,d!==null&&(d.fixedFoveation=K),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=K)},this.hasDepthSensing=function(){return g.texture!==null},this.getDepthSensingMesh=function(){return g.getMesh(W)},this.getCameraTexture=function(K){return p[K]};let Q=null;function we(K,pe){if(h=pe.getViewerPose(c||a),m=pe,h!==null){let xe=h.views;f!==null&&(e.setRenderTargetFramebuffer(y,f.framebuffer),e.setRenderTarget(y));let Re=!1;xe.length!==W.cameras.length&&(W.cameras.length=0,Re=!0);for(let Le=0;Le<xe.length;Le++){let Ze=xe[Le],it=null;if(f!==null)it=f.getViewport(Ze);else{let Ft=u.getViewSubImage(d,Ze);it=Ft.viewport,Le===0&&(e.setRenderTargetTextures(y,Ft.colorTexture,Ft.depthStencilTexture),e.setRenderTarget(y))}let Xe=B[Le];Xe===void 0&&(Xe=new Mt,Xe.layers.enable(Le),Xe.viewport=new et,B[Le]=Xe),Xe.matrix.fromArray(Ze.transform.matrix),Xe.matrix.decompose(Xe.position,Xe.quaternion,Xe.scale),Xe.projectionMatrix.fromArray(Ze.projectionMatrix),Xe.projectionMatrixInverse.copy(Xe.projectionMatrix).invert(),Xe.viewport.set(it.x,it.y,it.width,it.height),Le===0&&(W.matrix.copy(Xe.matrix),W.matrix.decompose(W.position,W.quaternion,W.scale)),Re===!0&&W.cameras.push(Xe)}let me=s.enabledFeatures;if(me&&me.includes("depth-sensing")&&s.depthUsage=="gpu-optimized"&&b){u=n.getBinding();let Le=u.getDepthInformation(xe[0]);Le&&Le.isValid&&Le.texture&&g.init(Le,s.renderState)}if(me&&me.includes("camera-access")&&b){e.state.unbindTexture(),u=n.getBinding();for(let Le=0;Le<xe.length;Le++){let Ze=xe[Le].camera;if(Ze){let it=p[Ze];it||(it=new Yr,p[Ze]=it);let Xe=u.getCameraImage(Ze);it.sourceTexture=Xe}}}}for(let xe=0;xe<S.length;xe++){let Re=E[xe],me=S[xe];Re!==null&&me!==void 0&&me.update(Re,pe,c||a)}Q&&Q(K,pe),pe.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:pe}),m=null}let Fe=new dp;Fe.setAnimationLoop(we),this.setAnimationLoop=function(K){Q=K},this.dispose=function(){}}},jv=new ke,wp=new De;wp.set(-1,0,0,0,1,0,0,0,1);Jv=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),ei=null;gs=class{constructor(e={}){let{canvas:t=Nf(),context:n=null,depth:s=!0,stencil:r=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:u=!1,reversedDepthBuffer:d=!1,outputBufferType:f=ln}=e;this.isWebGLRenderer=!0;let m;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");m=n.getContextAttributes().alpha}else m=a;let b=f,g=new Set([Vo,Go,zo]),p=new Set([ln,Bn,hr,fs,Oo,Bo]),x=new Uint32Array(4),w=new Int32Array(4),y={textures:[],min:[],max:[],resolution:[]},S=null,E=null,_=[],A=[],k=null;this.domElement=t,this.debug={checkShaderErrors:!0,diagnostics:{keywords:!1},onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=Zn,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let R=this,D=!1,B=null,W=null,I=null,G=null;this._outputColorSpace=wt;let j=0,z=0,te=null,q=-1,Z=null,Q=new et,we=new et,Fe=null,K=new Ee(0),pe=0,xe=t.width,Re=t.height,me=1,Oe=null,mt=null,Le=new et(0,0,xe,Re),Ze=new et(0,0,xe,Re),it=!1,Xe=new ki,Ft=new bo,yt=!1,tn=!1,ht=new ke,Vn=new L,Tt=new et,_n={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},bn=!1;function xn(){return te===null?me:1}let N=n;function yn(M,P){return t.getContext(M,P)}let lt,ct,ue,vt,Ce,Ne,T,v,U,ee,$,se,ce,X,Y,ae,C,J,V,oe,ie,re,Ae;try{let M={alpha:!0,depth:s,stencil:r,antialias:o,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:h,failIfMajorPerformanceCaveat:u};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${"187"}`),t.addEventListener("webglcontextlost",Te,!1),t.addEventListener("webglcontextrestored",Be,!1),t.addEventListener("webglcontextcreationerror",de,!1),N===null){let P="webgl2";if(N=yn(P,M),N===null)throw yn(P)?new Error("THREE.WebGLRenderer: Error creating WebGL context with your selected attributes."):new Error("THREE.WebGLRenderer: Error creating WebGL context.")}He()}catch(M){throw t.removeEventListener("webglcontextlost",Te,!1),t.removeEventListener("webglcontextrestored",Be,!1),t.removeEventListener("webglcontextcreationerror",de,!1),Pe("WebGLRenderer: "+M.message),M}function He(){lt=new ly(N),lt.init(),ie=new Wv(N,lt),ct=new $x(N,lt,e,ie),ue=new Gv(N,lt),ct.reversedDepthBuffer&&d&&ue.buffers.depth.setReversed(!0),W=N.createFramebuffer(),I=N.createFramebuffer(),G=N.createFramebuffer(),vt=new uy(N),Ce=new Rv,Ne=new Vv(N,lt,ue,Ce,ct,ie,vt),T=new oy(R),v=new f_(N),re=new Kx(N,v),U=new cy(N,v,vt,re),ee=new fy(N,U,v,re,vt),J=new dy(N,ct,Ne),Y=new Zx(Ce),$=new Tv(R,T,lt,ct,re,Y),se=new Yv(R,Ce),ce=new Lv,X=new Fv(lt),C=new Yx(R,T,ue,ee,m,l),ae=new zv(R,ee,ct),Ae=new Kv(N,vt,ct,ue),V=new Jx(N,lt,vt),oe=new hy(N,lt,vt),vt.programs=$.programs,R.capabilities=ct,R.extensions=lt,R.properties=Ce,R.renderLists=ce,R.shadowMap=ae,R.state=ue,R.info=vt}b!==ln&&(k=new my(b,t.width,t.height,o,s,r));let ne=new qh(R,N);this.xr=ne,this.getContext=function(){return N},this.getContextAttributes=function(){return N.getContextAttributes()},this.forceContextLoss=function(){let M=lt.get("WEBGL_lose_context");M&&M.loseContext()},this.forceContextRestore=function(){let M=lt.get("WEBGL_lose_context");M&&M.restoreContext()},this.getPixelRatio=function(){return me},this.setPixelRatio=function(M){M!==void 0&&(me=M,this.setSize(xe,Re,!1))},this.getSize=function(M){return M.set(xe,Re)},this.setSize=function(M,P,H=!0){if(ne.isPresenting){Se("WebGLRenderer: Can't change size while VR device is presenting.");return}xe=M,Re=P,t.width=Math.floor(M*me),t.height=Math.floor(P*me),H===!0&&(t.style.width=M+"px",t.style.height=P+"px"),k!==null&&k.setSize(t.width,t.height),this.setViewport(0,0,M,P)},this.getDrawingBufferSize=function(M){return M.set(xe*me,Re*me).floor()},this.setDrawingBufferSize=function(M,P,H){xe=M,Re=P,me=H,t.width=Math.floor(M*H),t.height=Math.floor(P*H),this.setViewport(0,0,M,P)},this.setEffects=function(M){if(b===ln){Pe("WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(M){for(let P=0;P<M.length;P++)if(M[P].isOutputPass===!0){Se("WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}k.setEffects(M||[])},this.getCurrentViewport=function(M){return M.copy(Q)},this.getViewport=function(M){return M.copy(Le)},this.setViewport=function(M,P,H,F){M.isVector4?Le.set(M.x,M.y,M.z,M.w):Le.set(M,P,H,F),ue.viewport(Q.copy(Le).multiplyScalar(xn()).round())},this.getScissor=function(M){return M.copy(Ze)},this.setScissor=function(M,P,H,F){M.isVector4?Ze.set(M.x,M.y,M.z,M.w):Ze.set(M,P,H,F),ue.scissor(we.copy(Ze).multiplyScalar(xn()).round())},this.getScissorTest=function(){return it},this.setScissorTest=function(M){ue.setScissorTest(it=M)},this.setOpaqueSort=function(M){Oe=M},this.setTransparentSort=function(M){mt=M},this.getClearColor=function(M){return M.copy(C.getClearColor())},this.setClearColor=function(){C.setClearColor(...arguments)},this.getClearAlpha=function(){return C.getClearAlpha()},this.setClearAlpha=function(){C.setClearAlpha(...arguments)},this.clear=function(M=!0,P=!0,H=!0){let F=0;if(M){let O=!1;if(te!==null){let he=te.texture.format;O=g.has(he)}if(O){let he=te.texture.type,be=p.has(he),le=C.getClearColor(),ge=C.getClearAlpha(),Me=le.r,Ue=le.g,je=le.b;be?(x[0]=Me,x[1]=Ue,x[2]=je,x[3]=ge,N.clearBufferuiv(N.COLOR,0,x)):(w[0]=Me,w[1]=Ue,w[2]=je,w[3]=ge,N.clearBufferiv(N.COLOR,0,w))}else F|=N.COLOR_BUFFER_BIT}P&&(F|=N.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),H&&(F|=N.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),F!==0&&N.clear(F)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(M){M.setRenderer(this),B=M},this.dispose=function(){t.removeEventListener("webglcontextlost",Te,!1),t.removeEventListener("webglcontextrestored",Be,!1),t.removeEventListener("webglcontextcreationerror",de,!1),C.dispose(),ce.dispose(),X.dispose(),Ne.dispose(),Ce.dispose(),T.dispose(),ee.dispose(),U.dispose(),re.dispose(),Ae.dispose(),$.dispose(),ne.dispose(),ne.removeEventListener("sessionstart",nd),ne.removeEventListener("sessionend",id),Wi.stop()};function Te(M){M.preventDefault(),Ur("WebGLRenderer: Context Lost."),D=!0}function Be(){Ur("WebGLRenderer: Context Restored."),D=!1;let M=vt.autoReset,P=ae.enabled,H=ae.autoUpdate,F=ae.needsUpdate,O=ae.type;He(),vt.autoReset=M,ae.enabled=P,ae.autoUpdate=H,ae.needsUpdate=F,ae.type=O}function de(M){Pe("WebGLRenderer: A WebGL context could not be created. Reason: ",M.statusMessage)}function Qe(M){let P=M.target;P.removeEventListener("dispose",Qe),Rt(P)}function Rt(M){Mi(M),Ce.remove(M)}function Mi(M){let P=Ce.get(M).programs;P!==void 0&&(P.forEach(function(H){$.releaseProgram(H)}),M.isShaderMaterial&&$.releaseShaderCache(M))}this.renderBufferDirect=function(M,P,H,F,O,he){P===null&&(P=_n);let be=O.isMesh&&O.matrixWorld.determinantAffine()<0,le=Zg(M,P,H,F,O);ue.setMaterial(F,be);let ge=H.index,Me=1;if(F.wireframe===!0){if(ge=U.getWireframeAttribute(H),ge===void 0)return;Me=2}let Ue=H.drawRange,je=H.attributes.position,ye=Ue.start*Me,Ye=(Ue.start+Ue.count)*Me;he!==null&&(ye=Math.max(ye,he.start*Me),Ye=Math.min(Ye,(he.start+he.count)*Me)),ge!==null?(ye=Math.max(ye,0),Ye=Math.min(Ye,ge.count)):je!=null&&(ye=Math.max(ye,0),Ye=Math.min(Ye,je.count));let gt=Ye-ye;if(gt<0||gt===1/0)return;re.setup(O,F,le,H,ge);let ot,st=V;if(ge!==null&&(ot=v.get(ge),st=oe,st.setIndex(ot)),O.isMesh)F.wireframe===!0?(ue.setLineWidth(F.wireframeLinewidth*xn()),st.setMode(N.LINES)):st.setMode(N.TRIANGLES);else if(O.isLine){let Gt=F.linewidth;Gt===void 0&&(Gt=1),ue.setLineWidth(Gt*xn()),O.isLineSegments?st.setMode(N.LINES):O.isLineLoop?st.setMode(N.LINE_LOOP):st.setMode(N.LINE_STRIP)}else O.isPoints?st.setMode(N.POINTS):O.isSprite&&st.setMode(N.TRIANGLES);if(O.isBatchedMesh)if(lt.get("WEBGL_multi_draw"))st.renderMultiDraw(O._multiDrawStarts,O._multiDrawCounts,O._multiDrawCount);else{let Gt=O._multiDrawStarts,ve=O._multiDrawCounts,Yt=O._multiDrawCount,Je=ge?v.get(ge).bytesPerElement:1,qi=Ce.get(F).currentProgram.getUniforms();for(let Vt=0;Vt<Yt;Vt++)qi.setValue(N,"_gl_DrawID",Vt),st.render(Gt[Vt]/Je,ve[Vt])}else if(O.isInstancedMesh)st.renderInstances(ye,gt,O.count);else if(H.isInstancedBufferGeometry){let Gt=H._maxInstanceCount!==void 0?H._maxInstanceCount:1/0,ve=Math.min(H.instanceCount,Gt);st.renderInstances(ye,gt,ve)}else st.render(ye,gt)};function td(M,P,H,F){B!==null&&M.isNodeMaterial&&B.setObject(F,M),yt===!0&&Y.setState(M,H,!1),M.transparent===!0&&M.side===on&&M.forceSinglePass===!1?(M.side=en,M.needsUpdate=!0,Sr(M,P,F),M.side=$n,M.needsUpdate=!0,Sr(M,P,F),M.side=on):Sr(M,P,F)}this.compile=function(M,P,H=null){H===null&&(H=M),B!==null&&B.renderStart(M,P,H),E=X.get(H),E.init(P),A.push(E),H.traverseVisible(function(O){O.isLight&&O.layers.test(P.layers)&&(E.pushLight(O),O.castShadow&&E.pushShadow(O))}),M!==H&&M.traverseVisible(function(O){O.isLight&&O.layers.test(P.layers)&&(E.pushLight(O),O.castShadow&&E.pushShadow(O))}),E.setupLights(),B!==null&&B.updateLights(E.state.lightsArray),tn=this.localClippingEnabled,yt=Y.init(this.clippingPlanes,tn),yt===!0&&Y.setGlobalState(this.clippingPlanes,P),B!==null&&ae.render(E.state.shadowsArray,H,P);let F=new Set;return M.traverse(function(O){if(!(O.isMesh||O.isPoints||O.isLine||O.isSprite))return;let he=O.material;if(he)if(Array.isArray(he))for(let be=0;be<he.length;be++){let le=he[be];td(le,H,P,O),F.add(le)}else td(he,H,P,O),F.add(he)}),E=A.pop(),B!==null&&B.renderEnd(),F},this.compileAsync=function(M,P,H=null){let F=this.compile(M,P,H);return new Promise(O=>{function he(){if(F.forEach(function(be){let ge=Ce.get(be).currentProgram;(ge===void 0||ge.isReady())&&F.delete(be)}),F.size===0){O(M);return}setTimeout(he,10)}lt.get("KHR_parallel_shader_compile")!==null?he():setTimeout(he,10)})};let hc=null;function Jg(M){hc&&hc(M)}function nd(){Wi.stop()}function id(){Wi.start()}let Wi=new dp;Wi.setAnimationLoop(Jg),typeof self<"u"&&Wi.setContext(self),this.setAnimationLoop=function(M){hc=M,ne.setAnimationLoop(M),M===null?Wi.stop():Wi.start()},ne.addEventListener("sessionstart",nd),ne.addEventListener("sessionend",id),this.render=function(M,P){if(P!==void 0&&P.isCamera!==!0){Pe("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(D===!0)return;B!==null&&B.renderStart(M,P);let H=ne.enabled===!0&&ne.isPresenting===!0,F=k!==null&&(te===null||H)&&k.begin(R,te);if(M.matrixWorldAutoUpdate===!0&&M.updateMatrixWorld(),P.parent===null&&P.matrixWorldAutoUpdate===!0&&P.updateMatrixWorld(),ne.enabled===!0&&ne.isPresenting===!0&&(k===null||k.isCompositing()===!1)&&(ne.cameraAutoUpdate===!0&&ne.updateCamera(P),P=ne.getCamera()),M.isScene===!0&&M.onBeforeRender(R,M,P,te),E=X.get(M,A.length),E.init(P),E.state.textureUnits=Ne.getTextureUnits(),A.push(E),ht.multiplyMatrices(P.projectionMatrix,P.matrixWorldInverse),P.isArrayCamera?Ft.setFromArrayCamera(P):Xe.setFromProjectionMatrix(ht,Mn,P.reversedDepth),tn=this.localClippingEnabled,yt=Y.init(this.clippingPlanes,tn),S=ce.get(M,_.length),S.init(),_.push(S),this.info.render.frame++,ne.enabled===!0&&ne.isPresenting===!0){let be=R.xr.getDepthSensingMesh();be!==null&&uc(be,P,-1/0,R.sortObjects)}uc(M,P,0,R.sortObjects),S.finish(),B!==null&&B.updateLights(E.state.lightsArray),R.sortObjects===!0&&S.sort(Oe,mt),bn=ne.enabled===!1||ne.isPresenting===!1||ne.hasDepthSensing()===!1,bn&&C.addToRenderList(S,M),this.info.autoReset===!0&&this.info.reset(),yt===!0&&Y.beginShadows();let O=E.state.shadowsArray;if(ae.render(O,M,P),yt===!0&&Y.endShadows(),(F&&k.hasRenderPass())===!1){let be=S.opaque,le=S.transmissive;if(E.setupLights(),P.isArrayCamera){let ge=P.cameras;if(le.length>0)for(let Me=0,Ue=ge.length;Me<Ue;Me++){let je=ge[Me];rd(be,le,M,je)}bn&&C.render(M);for(let Me=0,Ue=ge.length;Me<Ue;Me++){let je=ge[Me];sd(S,M,je,je.viewport)}}else le.length>0&&rd(be,le,M,P),bn&&C.render(M),sd(S,M,P)}te!==null&&z===0&&(Ne.updateMultisampleRenderTarget(te),Ne.updateRenderTargetMipmap(te)),F&&k.end(R),M.isScene===!0&&M.onAfterRender(R,M,P),re.resetDefaultState(),q=-1,Z=null,A.pop(),A.length>0?(E=A[A.length-1],Ne.setTextureUnits(E.state.textureUnits),yt===!0&&Y.setGlobalState(R.clippingPlanes,E.state.camera)):E=null,_.pop(),_.length>0?S=_[_.length-1]:S=null,B!==null&&B.renderEnd()};function uc(M,P,H,F){if(M.visible===!1)return;if(M.layers.test(P.layers)){if(M.isGroup)H=M.renderOrder;else if(M.isLOD)M.autoUpdate===!0&&M.update(P);else if(M.isLight)E.pushLight(M),M.castShadow&&E.pushShadow(M);else if(M.isSprite){let be=P.isArrayCamera?Ft:Xe;if(!M.frustumCulled||M.intersectsFrustum(be)){F&&Tt.setFromMatrixPosition(M.matrixWorld).applyMatrix4(ht);let le=ee.update(M),ge=M.material;ge.visible&&S.push(M,le,ge,H,Tt.z,null,P)}}else if(M.isMesh||M.isLine||M.isPoints){let be=P.isArrayCamera?Ft:Xe;if(!M.frustumCulled||M.intersectsFrustum(be)){let le=ee.update(M),ge=M.material;if(F&&(M.boundingSphere!==void 0?(M.boundingSphere===null&&M.computeBoundingSphere(),Tt.copy(M.boundingSphere.center)):(le.boundingSphere===null&&le.computeBoundingSphere(),Tt.copy(le.boundingSphere.center)),Tt.applyMatrix4(M.matrixWorld).applyMatrix4(ht)),Array.isArray(ge)){let Me=le.groups;for(let Ue=0,je=Me.length;Ue<je;Ue++){let ye=Me[Ue],Ye=ge[ye.materialIndex];Ye&&Ye.visible&&S.push(M,le,Ye,H,Tt.z,ye,P)}}else ge.visible&&S.push(M,le,ge,H,Tt.z,null,P)}}}let he=M.children;for(let be=0,le=he.length;be<le;be++)uc(he[be],P,H,F)}function sd(M,P,H,F){let{opaque:O,transmissive:he,transparent:be}=M;E.setupLightsView(H),yt===!0&&Y.setGlobalState(R.clippingPlanes,H),F&&ue.viewport(Q.copy(F)),O.length>0&&Ra(O,P,H),he.length>0&&Ra(he,P,H),be.length>0&&Ra(be,P,H),ue.buffers.depth.setTest(!0),ue.buffers.depth.setMask(!0),ue.buffers.color.setMask(!0),ue.setPolygonOffset(!1)}function rd(M,P,H,F){if((H.isScene===!0?H.overrideMaterial:null)!==null)return;if(E.state.transmissionRenderTarget[F.id]===void 0){let ye=lt.has("EXT_color_buffer_half_float")||lt.has("EXT_color_buffer_float");E.state.transmissionRenderTarget[F.id]=new dn(1,1,{generateMipmaps:!0,type:ye?Hn:ln,minFilter:An,samples:Math.max(4,ct.samples),stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,colorSpace:Ge.workingColorSpace})}let he=E.state.transmissionRenderTarget[F.id],be=F.viewport||Q;he.setSize(be.z*R.transmissionResolutionScale,be.w*R.transmissionResolutionScale);let le=R.getRenderTarget(),ge=R.getActiveCubeFace(),Me=R.getActiveMipmapLevel();R.setRenderTarget(he),R.getClearColor(K),pe=R.getClearAlpha(),pe<1&&R.setClearColor(16777215,.5),R.clear(),bn&&C.render(H);let Ue=R.toneMapping;R.toneMapping=Zn;let je=F.viewport;if(F.viewport!==void 0&&(F.viewport=void 0),E.setupLightsView(F),yt===!0&&Y.setGlobalState(R.clippingPlanes,F),Ra(M,H,F),Ne.updateMultisampleRenderTarget(he),Ne.updateRenderTargetMipmap(he),lt.has("WEBGL_multisampled_render_to_texture")===!1){let ye=!1;for(let Ye=0,gt=P.length;Ye<gt;Ye++){let ot=P[Ye],{object:st,geometry:Gt,material:ve,group:Yt}=ot;if(ve.side===on&&st.layers.test(F.layers)){let Je=ve.side;ve.side=en,ve.needsUpdate=!0,ad(st,H,F,Gt,ve,Yt),ve.side=Je,ve.needsUpdate=!0,ye=!0}}ye===!0&&(Ne.updateMultisampleRenderTarget(he),Ne.updateRenderTargetMipmap(he))}R.setRenderTarget(le,ge,Me),R.setClearColor(K,pe),je!==void 0&&(F.viewport=je),R.toneMapping=Ue}function Ra(M,P,H){let F=P.isScene===!0?P.overrideMaterial:null;for(let O=0,he=M.length;O<he;O++){let be=M[O],{object:le,geometry:ge,group:Me}=be,Ue=be.material;Ue.allowOverride===!0&&F!==null&&(Ue=F),le.layers.test(H.layers)&&ad(le,P,H,ge,Ue,Me)}}function ad(M,P,H,F,O,he){B!==null&&O.isNodeMaterial&&B.setObject(M,O),M.onBeforeRender(R,P,H,F,O,he),M.modelViewMatrix.multiplyMatrices(H.matrixWorldInverse,M.matrixWorld),M.normalMatrix.getNormalMatrix(M.modelViewMatrix),O.onBeforeRender(R,P,H,F,M,he),O.transparent===!0&&O.side===on&&O.forceSinglePass===!1?(O.side=en,O.needsUpdate=!0,R.renderBufferDirect(H,P,F,O,M,he),O.side=$n,O.needsUpdate=!0,R.renderBufferDirect(H,P,F,O,M,he),O.side=on):R.renderBufferDirect(H,P,F,O,M,he),M.onAfterRender(R,P,H,F,O,he)}function od(M){let P=0;for(let H of M)H.texture!==null&&P++;return P}function Sr(M,P,H){P.isScene!==!0&&(P=_n);let F=Ce.get(M),O=E.state.lights,he=E.state.shadowsArray,be=O.state.version,le=$.getParameters(M,O.state,he,P,H,E.state.lightProbeGridArray),ge=$.getProgramCacheKey(le),Me=F.programs;F.environment=M.isMeshStandardMaterial||M.isMeshLambertMaterial||M.isMeshPhongMaterial?P.environment:null,F.fog=P.fog;let Ue=M.isMeshStandardMaterial||M.isMeshLambertMaterial&&!M.envMap||M.isMeshPhongMaterial&&!M.envMap;F.envMap=T.get(M.envMap||F.environment,Ue),F.envMapRotation=F.environment!==null&&M.envMap===null?P.environmentRotation:M.envMapRotation,Me===void 0&&(M.addEventListener("dispose",Qe),Me=new Map,F.programs=Me,F.programVariants=new Map);let je=Me.get(ge);if(je!==void 0){if(F.currentProgram===je&&F.lightsStateVersion===be)return cd(M,le),je}else le.uniforms=$.getUniforms(M),B!==null&&M.isNodeMaterial&&B.build(M,H,le),M.onBeforeCompile(le,R),je=$.acquireProgram(le,ge),Me.set(ge,je),F.uniforms=le.uniforms;let ye=F.uniforms;return(!M.isShaderMaterial&&!M.isRawShaderMaterial||M.clipping===!0)&&(ye.clippingPlanes=Y.uniform),cd(M,le),F.needsLights=e0(M),F.lightsStateVersion=be,F.needsLights&&(ye.ambientLightColor.value=O.state.ambient,ye.lightProbe.value=O.state.probe,ye.sunLights.value=O.state.sun,ye.sunLightShadows.value=O.state.sunShadow,ye.directionalLights.value=O.state.directional,ye.directionalLightShadows.value=O.state.directionalShadow,ye.spotLights.value=O.state.spot,ye.spotLightShadows.value=O.state.spotShadow,ye.rectAreaLights.value=O.state.rectArea,ye.ltc_1.value=O.state.rectAreaLTC1,ye.ltc_2.value=O.state.rectAreaLTC2,ye.pointLights.value=O.state.point,ye.pointLightShadows.value=O.state.pointShadow,ye.hemisphereLights.value=O.state.hemi,ye.sunShadowMatrix.value=O.state.sunShadowMatrix,ye.sunShadowCascade.value=O.state.sunShadowCascade,ye.directionalShadowMatrix.value=O.state.directionalShadowMatrix,ye.spotLightMatrix.value=O.state.spotLightMatrix,ye.spotLightMap.value=O.state.spotLightMap,ye.pointShadowMatrix.value=O.state.pointShadowMatrix),F.numLightProbeGrids=od(E.state.lightProbeGridArray),F.currentProgram=je,F.uniformsList=null,je}function $g(M,P,H,F,O){let he=Ce.get(M),be=he.currentProgram.id+","+F+","+O,le=he.programVariants.get(be);return le===void 0?(le=Sr(M,P,H),he.programVariants.set(be,le)):(he.currentProgram=le,he.uniformsList=null,he.outputColorSpace=F,he.toneMapping=O),le}function ld(M){if(M.uniformsList===null){let P=M.currentProgram.getUniforms();M.uniformsList=dr.seqWithValue(P.seq,M.uniforms)}return M.uniformsList}function cd(M,P){let H=Ce.get(M);H.outputColorSpace=P.outputColorSpace,H.batching=P.batching,H.batchingColor=P.batchingColor,H.instancing=P.instancing,H.instancingColor=P.instancingColor,H.instancingMorph=P.instancingMorph,H.skinning=P.skinning,H.morphTargets=P.morphTargets,H.morphNormals=P.morphNormals,H.morphColors=P.morphColors,H.morphTargetsCount=P.morphTargetsCount,H.numClippingPlanes=P.numClippingPlanes,H.numIntersection=P.numClipIntersection,H.vertexAlphas=P.vertexAlphas,H.vertexTangents=P.vertexTangents,H.toneMapping=P.toneMapping}function Zg(M,P,H,F,O){P.isScene!==!0&&(P=_n),Ne.resetTextureUnits();let he=P.fog,be=F.isMeshStandardMaterial||F.isMeshLambertMaterial||F.isMeshPhongMaterial?P.environment:null,le=te===null?R.outputColorSpace:te.isXRRenderTarget===!0?te.texture.colorSpace:Ge.workingColorSpace,ge=F.isMeshStandardMaterial||F.isMeshLambertMaterial&&!F.envMap||F.isMeshPhongMaterial&&!F.envMap,Me=T.get(F.envMap||be,ge),Ue=F.vertexColors===!0&&!!H.attributes.color&&H.attributes.color.itemSize===4,je=!!H.attributes.tangent&&(!!F.normalMap||F.anisotropy>0),ye=!!H.morphAttributes.position,Ye=!!H.morphAttributes.normal,gt=!!H.morphAttributes.color,ot=Zn;F.toneMapped&&(te===null||te.isXRRenderTarget===!0)&&(ot=R.toneMapping);let st=H.morphAttributes.position||H.morphAttributes.normal||H.morphAttributes.color,Gt=st!==void 0?st.length:0,ve=Ce.get(F),Yt=E.state.lights;if(yt===!0&&(tn===!0||M!==Z)){let ut=M===Z&&F.id===q;Y.setState(F,M,ut)}let Je=!1,qi=!1;F.version===ve.__version?ve.needsLights&&ve.lightsStateVersion!==Yt.state.version||O.isBatchedMesh&&ve.batching===!1||!O.isBatchedMesh&&ve.batching===!0||O.isBatchedMesh&&ve.batchingColor===!0&&O._colorsTexture===null||O.isBatchedMesh&&ve.batchingColor===!1&&O._colorsTexture!==null||O.isInstancedMesh&&ve.instancing===!1||!O.isInstancedMesh&&ve.instancing===!0||O.isSkinnedMesh&&ve.skinning===!1||!O.isSkinnedMesh&&ve.skinning===!0||O.isInstancedMesh&&ve.instancingColor===!0&&O.instanceColor===null||O.isInstancedMesh&&ve.instancingColor===!1&&O.instanceColor!==null||O.isInstancedMesh&&ve.instancingMorph===!0&&O.morphTexture===null||O.isInstancedMesh&&ve.instancingMorph===!1&&O.morphTexture!==null||ve.envMap!==Me||F.fog===!0&&ve.fog!==he||ve.numClippingPlanes!==void 0&&(ve.numClippingPlanes!==Y.numPlanes||ve.numIntersection!==Y.numIntersection)||ve.vertexAlphas!==Ue||ve.vertexTangents!==je||ve.morphTargets!==ye||ve.morphNormals!==Ye||ve.morphColors!==gt||ve.morphTargetsCount!==Gt||ve.numLightProbeGrids!==od(E.state.lightProbeGridArray)?Je=!0:(ve.outputColorSpace!==le||ve.toneMapping!==ot)&&(qi=!0):(Je=!0,ve.__version=F.version);let Vt=ve.currentProgram;(Je===!0||qi===!0)&&(Vt=qi===!0?$g(F,P,O,le,ot):Sr(F,P,O),B&&F.isNodeMaterial&&B.onUpdateProgram(F,Vt,ve));let Ca=!1,Si=!1,Xi=!1,Ke=Vt.getUniforms(),Ut=ve.uniforms;if(ue.useProgram(Vt.program)&&(Ca=!0,Si=!0,Xi=!0),F.id!==q&&(q=F.id,Si=!0),Ca||Z!==M){ue.buffers.depth.getReversed()&&M.reversedDepth!==!0&&(M._reversedDepth=!0,M.updateProjectionMatrix()),Ke.setValue(N,"projectionMatrix",M.projectionMatrix),Ke.setValue(N,"viewMatrix",M.matrixWorldInverse);let Ct=Ke.map.cameraPosition;Ct!==void 0&&Ct.setValue(N,Vn.setFromMatrixPosition(M.matrixWorld)),ct.logarithmicDepthBuffer&&Ke.setValue(N,"logDepthBufFC",2/(Math.log(M.far+1)/Math.LN2)),(F.isMeshPhongMaterial||F.isMeshToonMaterial||F.isMeshLambertMaterial||F.isMeshBasicMaterial||F.isMeshStandardMaterial||F.isShaderMaterial)&&Ke.setValue(N,"isOrthographic",M.isOrthographicCamera===!0),Z!==M&&(Z=M,Si=!0,Xi=!0)}if(ve.needsLights&&(Yt.state.sunShadowMap.length>0&&Ke.setValue(N,"sunShadowMap",Yt.state.sunShadowMap,Ne),Yt.state.directionalShadowMap.length>0&&Ke.setValue(N,"directionalShadowMap",Yt.state.directionalShadowMap,Ne),Yt.state.spotShadowMap.length>0&&Ke.setValue(N,"spotShadowMap",Yt.state.spotShadowMap,Ne),Yt.state.pointShadowMap.length>0&&Ke.setValue(N,"pointShadowMap",Yt.state.pointShadowMap,Ne)),O.isSkinnedMesh){Ke.setOptional(N,O,"bindMatrix"),Ke.setOptional(N,O,"bindMatrixInverse");let ut=O.skeleton;ut&&(ut.boneTexture===null&&ut.computeBoneTexture(),Ke.setValue(N,"boneTexture",ut.boneTexture,Ne))}O.isBatchedMesh&&(Ke.setOptional(N,O,"batchingTexture"),Ke.setValue(N,"batchingTexture",O._matricesTexture,Ne),Ke.setOptional(N,O,"batchingIdTexture"),Ke.setValue(N,"batchingIdTexture",O._indirectTexture,Ne),Ke.setOptional(N,O,"batchingColorTexture"),O._colorsTexture!==null&&Ke.setValue(N,"batchingColorTexture",O._colorsTexture,Ne));let Ln=H.morphAttributes;if((Ln.position!==void 0||Ln.normal!==void 0||Ln.color!==void 0)&&J.update(O,H,Vt),(Si||ve.receiveShadow!==O.receiveShadow)&&(ve.receiveShadow=O.receiveShadow,Ke.setValue(N,"receiveShadow",O.receiveShadow)),(F.isMeshStandardMaterial||F.isMeshLambertMaterial||F.isMeshPhongMaterial)&&F.envMap===null&&P.environment!==null&&(Ut.envMapIntensity.value=P.environmentIntensity),Ut.dfgLUT!==void 0&&(Ut.dfgLUT.value=$v()),Si){if(Ke.setValue(N,"toneMappingExposure",R.toneMappingExposure),ve.needsLights&&Qg(Ut,Xi),he&&F.fog===!0&&se.refreshFogUniforms(Ut,he),se.refreshMaterialUniforms(Ut,F,me,Re,E.state.transmissionRenderTarget[M.id]),ve.needsLights&&ve.numLightProbeGrids>0){let ut=y,Ct=0;for(let ri of E.state.lightProbeGridArray)ri.texture!==null&&(ut.textures[Ct]=ri.texture,ut.min[Ct]=ri.boundingBox.min,ut.max[Ct]=ri.boundingBox.max,ut.resolution[Ct]=ri.resolution,Ct++);for(let ri in ut)ut[ri].length=Ct;Ut.probesSH.value=ut.textures,Ut.probesMin.value=ut.min,Ut.probesMax.value=ut.max,Ut.probesResolution.value=ut.resolution}dr.upload(N,ld(ve),Ut,Ne)}if(F.isShaderMaterial&&F.uniformsNeedUpdate===!0&&(dr.upload(N,ld(ve),Ut,Ne),F.uniformsNeedUpdate=!1),F.isSpriteMaterial&&Ke.setValue(N,"center",O.center),Ke.setValue(N,"modelViewMatrix",O.modelViewMatrix),Ke.setValue(N,"normalMatrix",O.normalMatrix),Ke.setValue(N,"modelMatrix",O.matrixWorld),F.uniformsGroups!==void 0){let ut=F.uniformsGroups;for(let Ct=0,ri=ut.length;Ct<ri;Ct++){let ud=ut[Ct];Ae.update(ud,Vt),Ae.bind(ud,Vt)}}return Vt}function Qg(M,P){M.ambientLightColor.needsUpdate=P,M.lightProbe.needsUpdate=P,M.sunLights.needsUpdate=P,M.sunLightShadows.needsUpdate=P,M.directionalLights.needsUpdate=P,M.directionalLightShadows.needsUpdate=P,M.pointLights.needsUpdate=P,M.pointLightShadows.needsUpdate=P,M.spotLights.needsUpdate=P,M.spotLightShadows.needsUpdate=P,M.rectAreaLights.needsUpdate=P,M.hemisphereLights.needsUpdate=P}function e0(M){return M.isMeshLambertMaterial||M.isMeshToonMaterial||M.isMeshPhongMaterial||M.isMeshStandardMaterial||M.isShadowMaterial||M.isShaderMaterial&&M.lights===!0}this.getActiveCubeFace=function(){return j},this.getActiveMipmapLevel=function(){return z},this.getRenderTarget=function(){return te},this.setRenderTargetTextures=function(M,P,H){let F=Ce.get(M);F.__autoAllocateDepthBuffer=M.resolveDepthBuffer===!1,F.__autoAllocateDepthBuffer===!1&&(F.__useRenderToTexture=!1),Ce.get(M.texture).__webglTexture=P,Ce.get(M.depthTexture).__webglTexture=F.__autoAllocateDepthBuffer?void 0:H,F.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(M,P){let H=Ce.get(M);H.__webglFramebuffer=P,H.__useDefaultFramebuffer=P===void 0},this.setRenderTarget=function(M,P=0,H=0){te=M,j=P,z=H;let F=null,O=!1,he=!1;if(M){let le=Ce.get(M);if(le.__useDefaultFramebuffer!==void 0){ue.bindFramebuffer(N.FRAMEBUFFER,le.__webglFramebuffer),Q.copy(M.viewport),we.copy(M.scissor),Fe=M.scissorTest,ue.viewport(Q),ue.scissor(we),ue.setScissorTest(Fe),q=-1;return}else if(le.__webglFramebuffer===void 0)Ne.setupRenderTarget(M);else if(le.__hasExternalTextures)Ne.rebindTextures(M,Ce.get(M.texture).__webglTexture,Ce.get(M.depthTexture).__webglTexture);else if(M.depthBuffer){let Ue=M.depthTexture;if(le.__boundDepthTexture!==Ue){if(Ue!==null&&Ce.has(Ue)&&(M.width!==Ue.image.width||M.height!==Ue.image.height))throw new Error("THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.");Ne.setupDepthRenderbuffer(M)}}let ge=M.texture;(ge.isData3DTexture||ge.isDataArrayTexture||ge.isCompressedArrayTexture)&&(he=!0);let Me=Ce.get(M).__webglFramebuffer;M.isWebGLCubeRenderTarget?(Array.isArray(Me[P])?F=Me[P][H]:F=Me[P],O=!0):M.samples>0&&Ne.useMultisampledRTT(M)===!1?F=Ce.get(M).__webglMultisampledFramebuffer:Array.isArray(Me)?F=Me[H]:F=Me,Q.copy(M.viewport),we.copy(M.scissor),Fe=M.scissorTest}else Q.copy(Le).multiplyScalar(me).floor(),we.copy(Ze).multiplyScalar(me).floor(),Fe=it;if(H!==0&&(F=W),ue.bindFramebuffer(N.FRAMEBUFFER,F)&&ue.drawBuffers(M,F),ue.viewport(Q),ue.scissor(we),ue.setScissorTest(Fe),O){let le=Ce.get(M.texture);N.framebufferTexture2D(N.FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_CUBE_MAP_POSITIVE_X+P,le.__webglTexture,H)}else if(he){let le=P;for(let ge=0;ge<M.textures.length;ge++){let Me=Ce.get(M.textures[ge]);N.framebufferTextureLayer(N.FRAMEBUFFER,N.COLOR_ATTACHMENT0+ge,Me.__webglTexture,H,le)}}else if(M!==null&&H!==0){let le=Ce.get(M.texture);N.framebufferTexture2D(N.FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_2D,le.__webglTexture,H)}q=-1};function hd(M){let P=Ce.get(M);return(P.__readFormat!==M.format||P.__readType!==M.type)&&(P.__readFormat=M.format,P.__readType=M.type,P.__formatReadable=ct.textureFormatReadable(M.format),P.__typeReadable=ct.textureTypeReadable(M.type)),P}this.readRenderTargetPixels=function(M,P,H,F,O,he,be,le=0){if(!(M&&M.isWebGLRenderTarget)){Pe("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let ge=Ce.get(M).__webglFramebuffer;if(M.isWebGLCubeRenderTarget&&be!==void 0&&(ge=ge[be],Array.isArray(ge)&&(ge=ge[0])),ge){ue.bindFramebuffer(N.FRAMEBUFFER,ge);try{let Me=M.textures[le],Ue=Me.format,je=Me.type;M.textures.length>1&&N.readBuffer(N.COLOR_ATTACHMENT0+le);let ye=hd(Me);if(ye.__formatReadable===!1){Pe("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(ye.__typeReadable===!1){Pe("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}P>=0&&P<=M.width-F&&H>=0&&H<=M.height-O&&N.readPixels(P,H,F,O,ie.convert(Ue),ie.convert(je),he)}finally{let Me=te!==null?Ce.get(te).__webglFramebuffer:null;ue.bindFramebuffer(N.FRAMEBUFFER,Me)}}},this.readRenderTargetPixelsAsync=async function(M,P,H,F,O,he,be,le=0){if(!(M&&M.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let ge=Ce.get(M).__webglFramebuffer;if(M.isWebGLCubeRenderTarget&&be!==void 0&&(ge=ge[be],Array.isArray(ge)&&(ge=ge[0])),ge)if(P>=0&&P<=M.width-F&&H>=0&&H<=M.height-O){ue.bindFramebuffer(N.FRAMEBUFFER,ge);let Me=M.textures[le],Ue=Me.format,je=Me.type;M.textures.length>1&&N.readBuffer(N.COLOR_ATTACHMENT0+le);let ye=hd(Me);if(ye.__formatReadable===!1)throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(ye.__typeReadable===!1)throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let Ye=N.createBuffer();N.bindBuffer(N.PIXEL_PACK_BUFFER,Ye),N.bufferData(N.PIXEL_PACK_BUFFER,he.byteLength,N.STREAM_READ),N.readPixels(P,H,F,O,ie.convert(Ue),ie.convert(je),0),N.bindBuffer(N.PIXEL_PACK_BUFFER,null);let gt=te!==null?Ce.get(te).__webglFramebuffer:null;ue.bindFramebuffer(N.FRAMEBUFFER,gt);let ot=N.fenceSync(N.SYNC_GPU_COMMANDS_COMPLETE,0);return N.flush(),await Uf(N,ot,4),N.bindBuffer(N.PIXEL_PACK_BUFFER,Ye),N.getBufferSubData(N.PIXEL_PACK_BUFFER,0,he),N.bindBuffer(N.PIXEL_PACK_BUFFER,null),N.deleteBuffer(Ye),N.deleteSync(ot),he}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(M,P=null,H=0){let F=Math.pow(2,-H),O=Math.floor(M.image.width*F),he=Math.floor(M.image.height*F),be=P!==null?P.x:0,le=P!==null?P.y:0;Ne.setTexture2D(M,0),N.copyTexSubImage2D(N.TEXTURE_2D,H,0,0,be,le,O,he),ue.unbindTexture()},this.copyTextureToTexture=function(M,P,H=null,F=null,O=0,he=0){let be,le,ge,Me,Ue,je,ye,Ye,gt,ot=M.isCompressedTexture?M.mipmaps[he]:M.image;if(H!==null)be=H.max.x-H.min.x,le=H.max.y-H.min.y,ge=H.isBox3?H.max.z-H.min.z:1,Me=H.min.x,Ue=H.min.y,je=H.isBox3?H.min.z:0;else{let Ke=Math.pow(2,-O);be=Math.floor(ot.width*Ke),le=Math.floor(ot.height*Ke),M.isDataArrayTexture?ge=ot.depth:M.isData3DTexture?ge=Math.floor(ot.depth*Ke):ge=1,Me=0,Ue=0,je=0}F!==null?(ye=F.x,Ye=F.y,gt=F.z):(ye=0,Ye=0,gt=0);let st=ie.convert(P.format),Gt=ie.convert(P.type),ve;P.isData3DTexture?(Ne.setTexture3D(P,0),ve=N.TEXTURE_3D):P.isDataArrayTexture||P.isCompressedArrayTexture?(Ne.setTexture2DArray(P,0),ve=N.TEXTURE_2D_ARRAY):(Ne.setTexture2D(P,0),ve=N.TEXTURE_2D),ue.activeTexture(N.TEXTURE0),ue.pixelStorei(N.UNPACK_FLIP_Y_WEBGL,P.flipY),ue.pixelStorei(N.UNPACK_PREMULTIPLY_ALPHA_WEBGL,P.premultiplyAlpha),ue.pixelStorei(N.UNPACK_ALIGNMENT,P.unpackAlignment);let Yt=ue.getParameter(N.UNPACK_ROW_LENGTH),Je=ue.getParameter(N.UNPACK_IMAGE_HEIGHT),qi=ue.getParameter(N.UNPACK_SKIP_PIXELS),Vt=ue.getParameter(N.UNPACK_SKIP_ROWS),Ca=ue.getParameter(N.UNPACK_SKIP_IMAGES);ue.pixelStorei(N.UNPACK_ROW_LENGTH,ot.width),ue.pixelStorei(N.UNPACK_IMAGE_HEIGHT,ot.height),ue.pixelStorei(N.UNPACK_SKIP_PIXELS,Me),ue.pixelStorei(N.UNPACK_SKIP_ROWS,Ue),ue.pixelStorei(N.UNPACK_SKIP_IMAGES,je);let Si=M.isDataArrayTexture||M.isData3DTexture,Xi=P.isDataArrayTexture||P.isData3DTexture;if(M.isDepthTexture){let Ke=Ce.get(M),Ut=Ce.get(P),Ln=Ce.get(Ke.__renderTarget),ut=Ce.get(Ut.__renderTarget);ue.bindFramebuffer(N.READ_FRAMEBUFFER,Ln.__webglFramebuffer),ue.bindFramebuffer(N.DRAW_FRAMEBUFFER,ut.__webglFramebuffer);for(let Ct=0;Ct<ge;Ct++)Si&&(N.framebufferTextureLayer(N.READ_FRAMEBUFFER,N.COLOR_ATTACHMENT0,Ce.get(M).__webglTexture,O,je+Ct),N.framebufferTextureLayer(N.DRAW_FRAMEBUFFER,N.COLOR_ATTACHMENT0,Ce.get(P).__webglTexture,he,gt+Ct)),N.blitFramebuffer(Me,Ue,Me+be,Ue+le,ye,Ye,ye+be,Ye+le,N.DEPTH_BUFFER_BIT,N.NEAREST);ue.bindFramebuffer(N.READ_FRAMEBUFFER,null),ue.bindFramebuffer(N.DRAW_FRAMEBUFFER,null)}else if(O!==0||M.isRenderTargetTexture||Ce.has(M)){let Ke=Ce.get(M),Ut=Ce.get(P);ue.bindFramebuffer(N.READ_FRAMEBUFFER,I),ue.bindFramebuffer(N.DRAW_FRAMEBUFFER,G);for(let Ln=0;Ln<ge;Ln++)Si?N.framebufferTextureLayer(N.READ_FRAMEBUFFER,N.COLOR_ATTACHMENT0,Ke.__webglTexture,O,je+Ln):N.framebufferTexture2D(N.READ_FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_2D,Ke.__webglTexture,O),Xi?N.framebufferTextureLayer(N.DRAW_FRAMEBUFFER,N.COLOR_ATTACHMENT0,Ut.__webglTexture,he,gt+Ln):N.framebufferTexture2D(N.DRAW_FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_2D,Ut.__webglTexture,he),O!==0?N.blitFramebuffer(Me,Ue,Me+be,Ue+le,ye,Ye,ye+be,Ye+le,N.COLOR_BUFFER_BIT,N.NEAREST):Xi?N.copyTexSubImage3D(ve,he,ye,Ye,gt+Ln,Me,Ue,be,le):N.copyTexSubImage2D(ve,he,ye,Ye,Me,Ue,be,le);ue.bindFramebuffer(N.READ_FRAMEBUFFER,null),ue.bindFramebuffer(N.DRAW_FRAMEBUFFER,null)}else Xi?M.isDataTexture||M.isData3DTexture?N.texSubImage3D(ve,he,ye,Ye,gt,be,le,ge,st,Gt,ot.data):P.isCompressedArrayTexture?N.compressedTexSubImage3D(ve,he,ye,Ye,gt,be,le,ge,st,ot.data):N.texSubImage3D(ve,he,ye,Ye,gt,be,le,ge,st,Gt,ot):M.isDataTexture?N.texSubImage2D(N.TEXTURE_2D,he,ye,Ye,be,le,st,Gt,ot.data):M.isCompressedTexture?N.compressedTexSubImage2D(N.TEXTURE_2D,he,ye,Ye,ot.width,ot.height,st,ot.data):N.texSubImage2D(N.TEXTURE_2D,he,ye,Ye,be,le,st,Gt,ot);ue.pixelStorei(N.UNPACK_ROW_LENGTH,Yt),ue.pixelStorei(N.UNPACK_IMAGE_HEIGHT,Je),ue.pixelStorei(N.UNPACK_SKIP_PIXELS,qi),ue.pixelStorei(N.UNPACK_SKIP_ROWS,Vt),ue.pixelStorei(N.UNPACK_SKIP_IMAGES,Ca),he===0&&P.generateMipmaps===!0&&P.mipmapsAutoUpdate===!0&&N.generateMipmap(ve),ue.unbindTexture()},this.initRenderTarget=function(M){Ce.get(M).__webglFramebuffer===void 0&&Ne.setupRenderTarget(M)},this.initTexture=function(M){M.isCubeTexture?Ne.setTextureCube(M,0):M.isData3DTexture?Ne.setTexture3D(M,0):M.isDataArrayTexture||M.isCompressedArrayTexture?Ne.setTexture2DArray(M,0):Ne.setTexture2D(M,0),ue.unbindTexture()},this.resetState=function(){j=0,z=0,te=null,ue.reset(),re.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return Mn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=Ge._getDrawingBufferColorSpace(e),t.unpackColorSpace=Ge._getUnpackColorSpace()}}});function Rl(){if(typeof window>"u")return;let i=Number(window.__agent3dReservedContexts)||0;if(window.__agent3dReservedContexts=i+1,typeof window.__agent3dEnforceBudget=="function")try{window.__agent3dEnforceBudget()}catch{}}function Xh(){if(typeof window>"u")return;let i=Number(window.__agent3dReservedContexts)||0;window.__agent3dReservedContexts=Math.max(0,i-1)}var jh=rt(()=>{"use strict"});function Mp(){if(typeof window>"u")return!1;if(window.__walkDebug)return!0;try{return window.localStorage?.getItem("walk:debug")==="1"}catch{return!1}}var zn,Cl=rt(()=>{"use strict";zn={debug(...i){Mp()&&console.debug("[walk]",...i)},info(...i){Mp()&&console.info("[walk]",...i)},warn(...i){console.warn("[walk]",...i)},error(...i){console.error("[walk]",...i)}}});function Ll(i,e){try{sessionStorage.setItem(i,e)}catch{}}function Pl(){try{return window.matchMedia("(prefers-reduced-motion: reduce)").matches}catch{return!1}}function Sp(){try{return window.matchMedia("(pointer: coarse)").matches}catch{return!1}}function Il(){try{let i=document.createElement("canvas");return!!(window.WebGLRenderingContext&&(i.getContext("webgl2")||i.getContext("webgl")))}catch{return!1}}function zt(i,e,t){return Math.max(e,Math.min(t,i))}var kl=rt(()=>{"use strict"});function Yh(i,e){if(e===gh)return console.warn("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles."),i;if(e===ur||e===fa){let t=i.getIndex();if(t===null){let r=[],a=i.getAttribute("position");if(a!==void 0){for(let o=0;o<a.count;o++)r.push(o);i.setIndex(r),t=i.getIndex()}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible."),i}let n=t.count-2,s=[];if(e===ur)for(let r=1;r<=n;r++)s.push(t.getX(0)),s.push(t.getX(r)),s.push(t.getX(r+1));else for(let r=0;r<n;r++)r%2===0?(s.push(t.getX(r)),s.push(t.getX(r+1)),s.push(t.getX(r+2))):(s.push(t.getX(r+2)),s.push(t.getX(r+1)),s.push(t.getX(r)));return s.length/3!==n&&console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles."),i.setIndex(s),i.clearGroups(),i}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:",e),i}var Ap=rt(()=>{at()});function Ep(i){let e=new Map,t=new Map,n=i.clone();return Tp(i,n,function(s,r){e.set(r,s),t.set(s,r)}),n.traverse(function(s){if(!s.isSkinnedMesh)return;let r=s,a=e.get(s),o=a.skeleton.bones;r.skeleton=a.skeleton.clone(),r.bindMatrix.copy(a.bindMatrix),r.skeleton.bones=o.map(function(l){return t.get(l)}),r.bind(r.skeleton,r.bindMatrix)}),n}function Tp(i,e,t){t(i,e);for(let n=0;n<i.children.length;n++)Tp(i.children[n],e.children[n],t)}var Rp=rt(()=>{});var Dp={};La(Dp,{GLTFLoader:()=>xa});function Zv(){let i={};return{get:function(e){return i[e]},add:function(e,t){i[e]=t},remove:function(e){delete i[e]},removeAll:function(){i={}}}}function ft(i,e,t){let n=i.json.materials[e];return n.extensions&&n.extensions[t]?n.extensions[t]:null}function tw(i){return i.DefaultMaterial===void 0&&(i.DefaultMaterial=new os({color:16777215,emissive:0,metalness:1,roughness:1,transparent:!1,depthTest:!0,side:$n})),i.DefaultMaterial}function _s(i,e,t){for(let n in t.extensions)i[n]===void 0&&(e.userData.gltfExtensions=e.userData.gltfExtensions||{},e.userData.gltfExtensions[n]=t.extensions[n])}function ni(i,e){e.extras!==void 0&&(typeof e.extras=="object"?Object.assign(i.userData,e.extras):console.warn("THREE.GLTFLoader: Ignoring primitive type .extras, "+e.extras))}function nw(i,e,t){let n=!1,s=!1,r=!1;for(let c=0,h=e.length;c<h;c++){let u=e[c];if(u.POSITION!==void 0&&(n=!0),u.NORMAL!==void 0&&(s=!0),u.COLOR_0!==void 0&&(r=!0),n&&s&&r)break}if(!n&&!s&&!r)return Promise.resolve(i);let a=[],o=[],l=[];for(let c=0,h=e.length;c<h;c++){let u=e[c];if(n){let d=u.POSITION!==void 0?t.getDependency("accessor",u.POSITION):i.attributes.position;a.push(d)}if(s){let d=u.NORMAL!==void 0?t.getDependency("accessor",u.NORMAL):i.attributes.normal;o.push(d)}if(r){let d=u.COLOR_0!==void 0?t.getDependency("accessor",u.COLOR_0):i.attributes.color;l.push(d)}}return Promise.all([Promise.all(a),Promise.all(o),Promise.all(l)]).then(function(c){let h=c[0],u=c[1],d=c[2];return n&&(i.morphAttributes.position=h),s&&(i.morphAttributes.normal=u),r&&(i.morphAttributes.color=d),i.morphTargetsRelative=!0,i})}function iw(i,e){if(i.updateMorphTargets(),e.weights!==void 0)for(let t=0,n=e.weights.length;t<n;t++)i.morphTargetInfluences[t]=e.weights[t];if(e.extras&&Array.isArray(e.extras.targetNames)){let t=e.extras.targetNames;if(i.morphTargetInfluences.length===t.length){i.morphTargetDictionary={};for(let n=0,s=t.length;n<s;n++)i.morphTargetDictionary[t[n]]=n}else console.warn("THREE.GLTFLoader: Invalid extras.targetNames length. Ignoring names.")}}function sw(i){let e,t=i.extensions&&i.extensions[Ve.KHR_DRACO_MESH_COMPRESSION];if(t?e="draco:"+t.bufferView+":"+t.indices+":"+$h(t.attributes):e=i.indices+":"+$h(i.attributes)+":"+i.mode,i.targets!==void 0)for(let n=0,s=i.targets.length;n<s;n++)e+=":"+$h(i.targets[n]);return e}function $h(i){let e="",t=Object.keys(i).sort();for(let n=0,s=t.length;n<s;n++)e+=t[n]+":"+i[t[n]]+";";return e}function wu(i){switch(i){case Int8Array:return 1/127;case Uint8Array:return 1/255;case Int16Array:return 1/32767;case Uint16Array:return 1/65535;default:throw new Error("THREE.GLTFLoader: Unsupported normalized accessor component type.")}}function rw(i){return i.search(/\.jpe?g($|\?)/i)>0||i.search(/^data\:image\/jpeg/)===0?"image/jpeg":i.search(/\.webp($|\?)/i)>0||i.search(/^data\:image\/webp/)===0?"image/webp":i.search(/\.ktx2($|\?)/i)>0||i.search(/^data\:image\/ktx2/)===0?"image/ktx2":"image/png"}function ow(i,e,t){let n=e.attributes,s=new bt;if(n.POSITION!==void 0){let o=t.json.accessors[n.POSITION],l=o.min,c=o.max;if(l!==void 0&&c!==void 0){if(s.set(new L(l[0],l[1],l[2]),new L(c[0],c[1],c[2])),o.normalized){let h=wu(pr[o.componentType]);s.min.multiplyScalar(h),s.max.multiplyScalar(h)}}else{console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.");return}}else return;let r=e.targets;if(r!==void 0){let o=new L,l=new L;for(let c=0,h=r.length;c<h;c++){let u=r[c];if(u.POSITION!==void 0){let d=t.json.accessors[u.POSITION],f=d.min,m=d.max;if(f!==void 0&&m!==void 0){if(l.setX(Math.max(Math.abs(f[0]),Math.abs(m[0]))),l.setY(Math.max(Math.abs(f[1]),Math.abs(m[1]))),l.setZ(Math.max(Math.abs(f[2]),Math.abs(m[2]))),d.normalized){let b=wu(pr[d.componentType]);l.multiplyScalar(b)}o.max(l)}else console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.")}}s.expandByVector(o)}i.boundingBox=s;let a=new sn;s.getCenter(a.center),a.radius=s.min.distanceTo(s.max)/2,i.boundingSphere=a}function Ip(i,e,t){let n=e.attributes,s=[];function r(a,o){return t.getDependency("accessor",a).then(function(l){i.setAttribute(o,l)})}for(let a in n){let o=vu[a]||a.toLowerCase();o in i.attributes||s.push(r(n[a],o))}if(e.indices!==void 0&&!i.index){let a=t.getDependency("accessor",e.indices).then(function(o){i.setIndex(o)});s.push(a)}return Ge.workingColorSpace!==Jt&&"COLOR_0"in n&&console.warn(`THREE.GLTFLoader: Converting vertex colors from "srgb-linear" to "${Ge.workingColorSpace}" not supported.`),ni(i,e),ow(i,e,t),Promise.all(s).then(function(){return e.targets!==void 0?nw(i,e.targets,t):i})}var xa,Ve,Zh,Qh,eu,tu,nu,iu,su,ru,au,ou,lu,cu,hu,uu,du,fu,pu,Dl,mu,kp,ba,Cp,gu,_u,bu,xu,Nl,Qv,yu,Tn,pr,Lp,Pp,Kh,vu,zi,ew,Jh,aw,Mu,Su=rt(()=>{at();Ap();Rp();xa=class extends Yn{constructor(e){super(e),this.dracoLoader=null,this.ktx2Loader=null,this.meshoptDecoder=null,this.pluginCallbacks=[],this.register(function(t){return new tu(t)}),this.register(function(t){return new nu(t)}),this.register(function(t){return new iu(t)}),this.register(function(t){return new du(t)}),this.register(function(t){return new fu(t)}),this.register(function(t){return new pu(t)}),this.register(function(t){return new ru(t)}),this.register(function(t){return new au(t)}),this.register(function(t){return new ou(t)}),this.register(function(t){return new lu(t)}),this.register(function(t){return new eu(t)}),this.register(function(t){return new cu(t)}),this.register(function(t){return new su(t)}),this.register(function(t){return new uu(t)}),this.register(function(t){return new hu(t)}),this.register(function(t){return new Zh(t)}),this.register(function(t){return new Dl(t,Ve.EXT_MESHOPT_COMPRESSION)}),this.register(function(t){return new Dl(t,Ve.KHR_MESHOPT_COMPRESSION)}),this.register(function(t){return new mu(t)})}load(e,t,n,s){let r=this,a;if(this.resourcePath!=="")a=this.resourcePath;else if(this.path!==""){let c=bi.extractUrlBase(e);a=bi.resolveURL(c,this.path)}else a=bi.extractUrlBase(e);this.manager.itemStart(e);let o=function(c){s?s(c):console.error(c),r.manager.itemError(e),r.manager.itemEnd(e)},l=new nr(this.manager);l.setPriority(this.priority),l.setCache(this.cache),l.setPath(this.path),l.setResponseType("arraybuffer"),l.setRequestHeader(this.requestHeader),l.setWithCredentials(this.withCredentials),l.load(e,function(c){try{r.parse(c,a,function(h){t(h),r.manager.itemEnd(e)},o)}catch(h){o(h)}},n,o)}setDRACOLoader(e){return this.dracoLoader=e,this}setKTX2Loader(e){return this.ktx2Loader=e,this}setMeshoptDecoder(e){return this.meshoptDecoder=e,this}register(e){return this.pluginCallbacks.indexOf(e)===-1&&this.pluginCallbacks.push(e),this}unregister(e){return this.pluginCallbacks.indexOf(e)!==-1&&this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(e),1),this}parse(e,t,n,s){let r,a={},o={},l=new TextDecoder;if(typeof e=="string")r=JSON.parse(e);else if(e instanceof ArrayBuffer)if(l.decode(new Uint8Array(e,0,4))===kp){try{a[Ve.KHR_BINARY_GLTF]=new gu(e)}catch(u){s&&s(u);return}r=JSON.parse(a[Ve.KHR_BINARY_GLTF].content)}else r=JSON.parse(l.decode(e));else r=e;if(r.asset===void 0||r.asset.version[0]<2){s&&s(new Error("THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported."));return}let c=new Mu(r,{path:t||this.resourcePath||"",crossOrigin:this.crossOrigin,priority:this.priority,cache:this.cache,withCredentials:this.withCredentials,requestHeader:this.requestHeader,manager:this.manager,ktx2Loader:this.ktx2Loader,meshoptDecoder:this.meshoptDecoder});c.fileLoader.setRequestHeader(this.requestHeader);for(let h=0;h<this.pluginCallbacks.length;h++){let u=this.pluginCallbacks[h](c);u.name||console.error("THREE.GLTFLoader: Invalid plugin found: missing name"),o[u.name]=u,a[u.name]=!0}if(r.extensionsUsed)for(let h=0;h<r.extensionsUsed.length;++h){let u=r.extensionsUsed[h],d=r.extensionsRequired||[];switch(u){case Ve.KHR_MATERIALS_UNLIT:a[u]=new Qh;break;case Ve.KHR_DRACO_MESH_COMPRESSION:a[u]=new _u(r,this.dracoLoader);break;case Ve.KHR_TEXTURE_TRANSFORM:a[u]=new bu;break;case Ve.KHR_MESH_QUANTIZATION:a[u]=new xu;break;default:d.indexOf(u)>=0&&o[u]===void 0&&console.warn('THREE.GLTFLoader: Unknown extension "'+u+'".')}}c.setExtensions(a),c.setPlugins(o),c.parse(n,s)}parseAsync(e,t){let n=this;return new Promise(function(s,r){n.parse(e,t,s,r)})}};Ve={KHR_BINARY_GLTF:"KHR_binary_glTF",KHR_DRACO_MESH_COMPRESSION:"KHR_draco_mesh_compression",KHR_LIGHTS_PUNCTUAL:"KHR_lights_punctual",KHR_MATERIALS_CLEARCOAT:"KHR_materials_clearcoat",KHR_MATERIALS_DIFFUSE_ROUGHNESS:"KHR_materials_diffuse_roughness",KHR_MATERIALS_DISPERSION:"KHR_materials_dispersion",KHR_MATERIALS_IOR:"KHR_materials_ior",KHR_MATERIALS_SHEEN:"KHR_materials_sheen",KHR_MATERIALS_SPECULAR:"KHR_materials_specular",KHR_MATERIALS_TRANSMISSION:"KHR_materials_transmission",KHR_MATERIALS_IRIDESCENCE:"KHR_materials_iridescence",KHR_MATERIALS_ANISOTROPY:"KHR_materials_anisotropy",KHR_MATERIALS_UNLIT:"KHR_materials_unlit",KHR_MATERIALS_VOLUME:"KHR_materials_volume",KHR_TEXTURE_BASISU:"KHR_texture_basisu",KHR_TEXTURE_TRANSFORM:"KHR_texture_transform",KHR_MESH_QUANTIZATION:"KHR_mesh_quantization",KHR_MATERIALS_EMISSIVE_STRENGTH:"KHR_materials_emissive_strength",EXT_MATERIALS_BUMP:"EXT_materials_bump",EXT_TEXTURE_WEBP:"EXT_texture_webp",EXT_TEXTURE_AVIF:"EXT_texture_avif",EXT_MESHOPT_COMPRESSION:"EXT_meshopt_compression",KHR_MESHOPT_COMPRESSION:"KHR_meshopt_compression",EXT_MESH_GPU_INSTANCING:"EXT_mesh_gpu_instancing"},Zh=class{constructor(e){this.parser=e,this.name=Ve.KHR_LIGHTS_PUNCTUAL,this.cache={refs:{},uses:{}}}_markDefs(){let e=this.parser,t=this.parser.json.nodes||[];for(let n=0,s=t.length;n<s;n++){let r=t[n];r.extensions&&r.extensions[this.name]&&r.extensions[this.name].light!==void 0&&e._addNodeRef(this.cache,r.extensions[this.name].light)}}_loadLight(e){let t=this.parser,n="light:"+e,s=t.cache.get(n);if(s)return s;let r=t.json,l=((r.extensions&&r.extensions[this.name]||{}).lights||[])[e],c,h=new Ee(16777215);l.color!==void 0&&h.setRGB(l.color[0],l.color[1],l.color[2],Jt);let u=l.range!==void 0?l.range:0;switch(l.type){case"directional":c=new Jn(h),c.target.position.set(0,0,-1),c.add(c.target);break;case"point":c=new ia(h),c.distance=u;break;case"spot":c=new na(h),c.distance=u,l.spot=l.spot||{},l.spot.innerConeAngle=l.spot.innerConeAngle!==void 0?l.spot.innerConeAngle:0,l.spot.outerConeAngle=l.spot.outerConeAngle!==void 0?l.spot.outerConeAngle:Math.PI/4,c.angle=l.spot.outerConeAngle,c.penumbra=1-l.spot.innerConeAngle/l.spot.outerConeAngle,c.target.position.set(0,0,-1),c.add(c.target);break;default:throw new Error("THREE.GLTFLoader: Unexpected light type: "+l.type)}return c.position.set(0,0,0),ni(c,l),l.intensity!==void 0&&(c.intensity=l.intensity),c.name=t.createUniqueName(l.name||"light_"+e),s=Promise.resolve(c),t.cache.add(n,s),s}getDependency(e,t){if(e==="light")return this._loadLight(t)}createNodeAttachment(e){let t=this,n=this.parser,r=n.json.nodes[e],o=(r.extensions&&r.extensions[this.name]||{}).light;return o===void 0?null:this._loadLight(o).then(function(l){return n._getNodeRef(t.cache,o,l)})}},Qh=class{constructor(){this.name=Ve.KHR_MATERIALS_UNLIT}getMaterialType(){return Sn}extendParams(e,t,n){let s=[];e.color=new Ee(1,1,1),e.opacity=1;let r=t.pbrMetallicRoughness;if(r){if(Array.isArray(r.baseColorFactor)){let a=r.baseColorFactor;e.color.setRGB(a[0],a[1],a[2],Jt),e.opacity=a[3]}r.baseColorTexture!==void 0&&s.push(n.assignTexture(e,"map",r.baseColorTexture,wt))}return Promise.all(s)}},eu=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_EMISSIVE_STRENGTH}extendMaterialParams(e,t){let n=ft(this.parser,e,this.name);return n===null||n.emissiveStrength!==void 0&&(t.emissiveIntensity=n.emissiveStrength),Promise.resolve()}},tu=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_CLEARCOAT}getMaterialType(e){return ft(this.parser,e,this.name)!==null?Zt:null}extendMaterialParams(e,t){let n=ft(this.parser,e,this.name);if(n===null)return Promise.resolve();let s=[];if(n.clearcoatFactor!==void 0&&(t.clearcoat=n.clearcoatFactor),n.clearcoatTexture!==void 0&&s.push(this.parser.assignTexture(t,"clearcoatMap",n.clearcoatTexture)),n.clearcoatRoughnessFactor!==void 0&&(t.clearcoatRoughness=n.clearcoatRoughnessFactor),n.clearcoatRoughnessTexture!==void 0&&s.push(this.parser.assignTexture(t,"clearcoatRoughnessMap",n.clearcoatRoughnessTexture)),n.clearcoatNormalTexture!==void 0&&(s.push(this.parser.assignTexture(t,"clearcoatNormalMap",n.clearcoatNormalTexture)),n.clearcoatNormalTexture.scale!==void 0)){let r=n.clearcoatNormalTexture.scale;t.clearcoatNormalScale=new Ie(r,r)}return Promise.all(s)}},nu=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_DIFFUSE_ROUGHNESS}getMaterialType(e){return ft(this.parser,e,this.name)!==null?Zt:null}extendMaterialParams(e,t){let n=ft(this.parser,e,this.name);if(n===null)return Promise.resolve();let s=[];return t.diffuseRoughness=n.diffuseRoughnessFactor!==void 0?n.diffuseRoughnessFactor:0,n.diffuseRoughnessTexture!==void 0&&s.push(this.parser.assignTexture(t,"diffuseRoughnessMap",n.diffuseRoughnessTexture)),Promise.all(s)}},iu=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_DISPERSION}getMaterialType(e){return ft(this.parser,e,this.name)!==null?Zt:null}extendMaterialParams(e,t){let n=ft(this.parser,e,this.name);return n===null||(t.dispersion=n.dispersion!==void 0?n.dispersion:0),Promise.resolve()}},su=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_IRIDESCENCE}getMaterialType(e){return ft(this.parser,e,this.name)!==null?Zt:null}extendMaterialParams(e,t){let n=ft(this.parser,e,this.name);if(n===null)return Promise.resolve();let s=[];return n.iridescenceFactor!==void 0&&(t.iridescence=n.iridescenceFactor),n.iridescenceTexture!==void 0&&s.push(this.parser.assignTexture(t,"iridescenceMap",n.iridescenceTexture)),n.iridescenceIor!==void 0&&(t.iridescenceIOR=n.iridescenceIor),n.iridescenceThicknessMinimum!==void 0&&(t.iridescenceThicknessMinimum=n.iridescenceThicknessMinimum),n.iridescenceThicknessMaximum!==void 0&&(t.iridescenceThicknessMaximum=n.iridescenceThicknessMaximum),n.iridescenceThicknessTexture!==void 0&&s.push(this.parser.assignTexture(t,"iridescenceThicknessMap",n.iridescenceThicknessTexture)),Promise.all(s)}},ru=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_SHEEN}getMaterialType(e){return ft(this.parser,e,this.name)!==null?Zt:null}extendMaterialParams(e,t){let n=ft(this.parser,e,this.name);if(n===null)return Promise.resolve();let s=[];if(t.sheenColor=new Ee(0,0,0),t.sheenRoughness=0,t.sheen=1,n.sheenColorFactor!==void 0){let r=n.sheenColorFactor;t.sheenColor.setRGB(r[0],r[1],r[2],Jt)}return n.sheenRoughnessFactor!==void 0&&(t.sheenRoughness=n.sheenRoughnessFactor),n.sheenColorTexture!==void 0&&s.push(this.parser.assignTexture(t,"sheenColorMap",n.sheenColorTexture,wt)),n.sheenRoughnessTexture!==void 0&&s.push(this.parser.assignTexture(t,"sheenRoughnessMap",n.sheenRoughnessTexture)),Promise.all(s)}},au=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_TRANSMISSION}getMaterialType(e){return ft(this.parser,e,this.name)!==null?Zt:null}extendMaterialParams(e,t){let n=ft(this.parser,e,this.name);if(n===null)return Promise.resolve();let s=[];return n.transmissionFactor!==void 0&&(t.transmission=n.transmissionFactor),n.transmissionTexture!==void 0&&s.push(this.parser.assignTexture(t,"transmissionMap",n.transmissionTexture)),Promise.all(s)}},ou=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_VOLUME}getMaterialType(e){return ft(this.parser,e,this.name)!==null?Zt:null}extendMaterialParams(e,t){let n=ft(this.parser,e,this.name);if(n===null)return Promise.resolve();let s=[];t.thickness=n.thicknessFactor!==void 0?n.thicknessFactor:0,n.thicknessTexture!==void 0&&s.push(this.parser.assignTexture(t,"thicknessMap",n.thicknessTexture)),t.attenuationDistance=n.attenuationDistance||1/0;let r=n.attenuationColor||[1,1,1];return t.attenuationColor=new Ee().setRGB(r[0],r[1],r[2],Jt),Promise.all(s)}},lu=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_IOR}getMaterialType(e){return ft(this.parser,e,this.name)!==null?Zt:null}extendMaterialParams(e,t){let n=ft(this.parser,e,this.name);return n===null||(t.ior=n.ior!==void 0?n.ior:1.5,t.ior===0&&(t.ior=1e3)),Promise.resolve()}},cu=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_SPECULAR}getMaterialType(e){return ft(this.parser,e,this.name)!==null?Zt:null}extendMaterialParams(e,t){let n=ft(this.parser,e,this.name);if(n===null)return Promise.resolve();let s=[];t.specularIntensity=n.specularFactor!==void 0?n.specularFactor:1,n.specularTexture!==void 0&&s.push(this.parser.assignTexture(t,"specularIntensityMap",n.specularTexture));let r=n.specularColorFactor||[1,1,1];return t.specularColor=new Ee().setRGB(r[0],r[1],r[2],Jt),n.specularColorTexture!==void 0&&s.push(this.parser.assignTexture(t,"specularColorMap",n.specularColorTexture,wt)),Promise.all(s)}},hu=class{constructor(e){this.parser=e,this.name=Ve.EXT_MATERIALS_BUMP}getMaterialType(e){return ft(this.parser,e,this.name)!==null?Zt:null}extendMaterialParams(e,t){let n=ft(this.parser,e,this.name);if(n===null)return Promise.resolve();let s=[];return t.bumpScale=n.bumpFactor!==void 0?n.bumpFactor:1,n.bumpTexture!==void 0&&s.push(this.parser.assignTexture(t,"bumpMap",n.bumpTexture)),Promise.all(s)}},uu=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_ANISOTROPY}getMaterialType(e){return ft(this.parser,e,this.name)!==null?Zt:null}extendMaterialParams(e,t){let n=ft(this.parser,e,this.name);if(n===null)return Promise.resolve();let s=[];return n.anisotropyStrength!==void 0&&(t.anisotropy=n.anisotropyStrength),n.anisotropyRotation!==void 0&&(t.anisotropyRotation=n.anisotropyRotation),n.anisotropyTexture!==void 0&&s.push(this.parser.assignTexture(t,"anisotropyMap",n.anisotropyTexture)),Promise.all(s)}},du=class{constructor(e){this.parser=e,this.name=Ve.KHR_TEXTURE_BASISU}loadTexture(e){let t=this.parser,n=t.json,s=n.textures[e];if(!s.extensions||!s.extensions[this.name])return null;let r=s.extensions[this.name],a=t.options.ktx2Loader;if(!a){if(n.extensionsRequired&&n.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures");return null}return t.loadTextureImage(e,r.source,a)}},fu=class{constructor(e){this.parser=e,this.name=Ve.EXT_TEXTURE_WEBP}loadTexture(e){let t=this.name,n=this.parser,s=n.json,r=s.textures[e];if(!r.extensions||!r.extensions[t])return null;let a=r.extensions[t],o=s.images[a.source],l=n.textureLoader;if(o.uri){let c=n.options.manager.getHandler(o.uri);c!==null&&(l=c)}return n.loadTextureImage(e,a.source,l)}},pu=class{constructor(e){this.parser=e,this.name=Ve.EXT_TEXTURE_AVIF}loadTexture(e){let t=this.name,n=this.parser,s=n.json,r=s.textures[e];if(!r.extensions||!r.extensions[t])return null;let a=r.extensions[t],o=s.images[a.source],l=n.textureLoader;if(o.uri){let c=n.options.manager.getHandler(o.uri);c!==null&&(l=c)}return n.loadTextureImage(e,a.source,l)}},Dl=class{constructor(e,t){this.name=t,this.parser=e}loadBufferView(e){let t=this.parser.json,n=t.bufferViews[e];if(n.extensions&&n.extensions[this.name]){let s=n.extensions[this.name],r=this.parser.getDependency("buffer",s.buffer),a=this.parser.options.meshoptDecoder;if(!a||!a.supported){if(t.extensionsRequired&&t.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files");return null}return r.then(function(o){let l=s.byteOffset||0,c=s.byteLength||0,h=s.count,u=s.byteStride,d=new Uint8Array(o,l,c);return a.decodeGltfBufferAsync?a.decodeGltfBufferAsync(h,u,d,s.mode,s.filter).then(function(f){return f.buffer}):a.ready.then(function(){let f=new ArrayBuffer(h*u);return a.decodeGltfBuffer(new Uint8Array(f),h,u,d,s.mode,s.filter),f})})}else return null}},mu=class{constructor(e){this.name=Ve.EXT_MESH_GPU_INSTANCING,this.parser=e}createNodeMesh(e){let t=this.parser.json,n=t.nodes[e];if(!n.extensions||!n.extensions[this.name]||n.mesh===void 0)return null;let s=t.meshes[n.mesh];for(let c of s.primitives)if(c.mode!==Tn.TRIANGLES&&c.mode!==Tn.TRIANGLE_STRIP&&c.mode!==Tn.TRIANGLE_FAN&&c.mode!==void 0)return null;let a=n.extensions[this.name].attributes,o=[],l={};for(let c in a)o.push(this.parser.getDependency("accessor",a[c]).then(h=>(l[c]=h,l[c])));return o.length<1?null:(o.push(this.parser.createNodeMesh(e)),Promise.all(o).then(c=>{let h=c.pop(),u=h.isGroup?h.children:[h],d=c[0].count,f=[];for(let m of u){let b=new ke,g=new L,p=new _e,x=new L(1,1,1),w=new Gr(m.geometry,m.material,d);for(let S=0;S<d;S++)l.TRANSLATION&&g.fromBufferAttribute(l.TRANSLATION,S),l.ROTATION&&p.fromBufferAttribute(l.ROTATION,S),l.SCALE&&x.fromBufferAttribute(l.SCALE,S),w.setMatrixAt(S,b.compose(g,p,x));let y=null;for(let S in l)if(S==="_COLOR_0"){let E=l[S];w.instanceColor=new pi(E.array,E.itemSize,E.normalized)}else if(S!=="TRANSLATION"&&S!=="ROTATION"&&S!=="SCALE"){if(y===null){let _=w.geometry;y=new $t,y.name=_.name;for(let A in _.attributes)y.setAttribute(A,_.attributes[A]);for(let A in _.morphAttributes)y.morphAttributes[A]=_.morphAttributes[A];_.index!==null&&y.setIndex(_.index),y.morphTargetsRelative=_.morphTargetsRelative;for(let A of _.groups)y.addGroup(A.start,A.count,A.materialIndex);_.boundingBox!==null&&(y.boundingBox=_.boundingBox.clone()),_.boundingSphere!==null&&(y.boundingSphere=_.boundingSphere.clone()),y.drawRange.start=_.drawRange.start,y.drawRange.count=_.drawRange.count,y.userData=Object.assign({},_.userData),w.geometry=y}let E=l[S];y.setAttribute(S,new pi(E.array,E.itemSize,E.normalized))}nt.prototype.copy.call(w,m),this.parser.assignFinalMaterial(w),f.push(w)}return h.isGroup?(h.clear(),h.add(...f),h):f[0]}))}},kp="glTF",ba=12,Cp={JSON:1313821514,BIN:5130562},gu=class{constructor(e){this.name=Ve.KHR_BINARY_GLTF,this.content=null,this.body=null;let t=new DataView(e,0,ba),n=new TextDecoder;if(this.header={magic:n.decode(new Uint8Array(e.slice(0,4))),version:t.getUint32(4,!0),length:t.getUint32(8,!0)},this.header.magic!==kp)throw new Error("THREE.GLTFLoader: Unsupported glTF-Binary header.");if(this.header.version<2)throw new Error("THREE.GLTFLoader: Legacy binary file detected.");let s=this.header.length-ba,r=new DataView(e,ba),a=0;for(;a<s;){let o=r.getUint32(a,!0);a+=4;let l=r.getUint32(a,!0);if(a+=4,l===Cp.JSON){let c=new Uint8Array(e,ba+a,o);this.content=n.decode(c)}else if(l===Cp.BIN){let c=ba+a;this.body=e.slice(c,c+o)}a+=o}if(this.content===null)throw new Error("THREE.GLTFLoader: JSON content not found.")}},_u=class{constructor(e,t){if(!t)throw new Error("THREE.GLTFLoader: No DRACOLoader instance provided.");this.name=Ve.KHR_DRACO_MESH_COMPRESSION,this.json=e,this.dracoLoader=t,this.dracoLoader.preload()}decodePrimitive(e,t){let n=this.json,s=this.dracoLoader,r=e.extensions[this.name].bufferView,a=e.extensions[this.name].attributes,o={},l={},c={};for(let h in a){let u=vu[h]||h.toLowerCase();o[u]=a[h]}for(let h in e.attributes){let u=vu[h]||h.toLowerCase();if(a[h]!==void 0){let d=n.accessors[e.attributes[h]],f=pr[d.componentType];c[u]=f.name,l[u]=d.normalized===!0}}return t.getDependency("bufferView",r).then(function(h){return new Promise(function(u,d){s.decodeDracoFile(h,function(f){for(let m in f.attributes){let b=f.attributes[m],g=l[m];g!==void 0&&(b.normalized=g)}u(f)},o,c,Jt,d)})})}},bu=class{constructor(){this.name=Ve.KHR_TEXTURE_TRANSFORM}extendTexture(e,t){if((t.texCoord===void 0||t.texCoord===e.channel)&&t.offset===void 0&&t.rotation===void 0&&t.scale===void 0)return e;if(e=e.clone(),t.texCoord!==void 0&&(e.channel=t.texCoord),t.offset!==void 0&&e.offset.fromArray(t.offset),t.rotation!==void 0&&(e.rotation=t.rotation),t.scale!==void 0&&e.repeat.fromArray(t.scale),t.rotation!==void 0){let n=Math.cos(e.rotation),s=Math.sin(e.rotation);e.matrix.set(e.repeat.x*n,e.repeat.y*s,e.offset.x,-e.repeat.x*s,e.repeat.y*n,e.offset.y,0,0,1),e.matrixAutoUpdate=!1}return e.needsUpdate=!0,e}},xu=class{constructor(){this.name=Ve.KHR_MESH_QUANTIZATION}},Nl=class extends jn{constructor(e,t,n,s){super(e,t,n,s)}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,s=this.valueSize,r=e*s*3+s;for(let a=0;a!==s;a++)t[a]=n[r+a];return t}interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=o*2,c=o*3,h=s-t,u=(n-t)/h,d=u*u,f=d*u,m=e*c,b=m-c,g=-2*f+3*d,p=f-d,x=1-g,w=p-d+u;for(let y=0;y!==o;y++){let S=a[b+y+o],E=a[b+y+l]*h,_=a[m+y+o],A=a[m+y]*h;r[y]=x*S+w*E+g*_+p*A}return r}},Qv=new _e,yu=class extends Nl{interpolate_(e,t,n,s){let r=super.interpolate_(e,t,n,s);return Qv.fromArray(r).normalize().toArray(r),r}},Tn={FLOAT:5126,FLOAT_MAT3:35675,FLOAT_MAT4:35676,FLOAT_VEC2:35664,FLOAT_VEC3:35665,FLOAT_VEC4:35666,LINEAR:9729,REPEAT:10497,SAMPLER_2D:35678,POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRIANGLE_STRIP:5,TRIANGLE_FAN:6,UNSIGNED_BYTE:5121,UNSIGNED_SHORT:5123},pr={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},Lp={9728:pt,9729:St,9984:Fo,9985:cr,9986:ds,9987:An},Pp={33071:wn,33648:Vs,10497:Pi},Kh={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},vu={POSITION:"position",NORMAL:"normal",TANGENT:"tangent",TEXCOORD_0:"uv",TEXCOORD_1:"uv1",TEXCOORD_2:"uv2",TEXCOORD_3:"uv3",COLOR_0:"color",WEIGHTS_0:"skinWeight",JOINTS_0:"skinIndex"},zi={scale:"scale",translation:"position",rotation:"quaternion",weights:"morphTargetInfluences"},ew={CUBICSPLINE:void 0,LINEAR:ts,STEP:es},Jh={OPAQUE:"OPAQUE",MASK:"MASK",BLEND:"BLEND"};aw=new ke,Mu=class{constructor(e={},t={}){this.json=e,this.extensions={},this.plugins={},this.options=t,this.cache=new Zv,this.associations=new Map,this.primitiveCache={},this.nodeCache={},this.meshCache={refs:{},uses:{}},this.cameraCache={refs:{},uses:{}},this.lightCache={refs:{},uses:{}},this.sourceCache={},this.textureCache={},this.nodeNamesUsed={};let n=!1,s=-1,r=!1,a=-1;if(typeof navigator<"u"&&typeof navigator.userAgent<"u"){let o=navigator.userAgent;n=/^((?!chrome|android).)*safari/i.test(o)===!0;let l=o.match(/Version\/(\d+)/);s=n&&l?parseInt(l[1],10):-1,r=o.indexOf("Firefox")>-1,a=r?o.match(/Firefox\/([0-9]+)\./)[1]:-1}typeof createImageBitmap>"u"||n&&s<17||r&&a<98?(this.textureLoader=new ea(this.options.manager),this.textureLoader.setPriority(this.options.priority),this.textureLoader.setCache(this.options.cache)):(this.textureLoader=new sa(this.options.manager),this.textureLoader.setPriority(this.options.priority),this.textureLoader.setCache(this.options.cache)),this.textureLoader.setCrossOrigin(this.options.crossOrigin),this.textureLoader.setWithCredentials(this.options.withCredentials),this.textureLoader.setRequestHeader(this.options.requestHeader),this.fileLoader=new nr(this.options.manager),this.fileLoader.setPriority(this.options.priority),this.fileLoader.setCache(this.options.cache),this.fileLoader.setResponseType("arraybuffer"),(this.options.withCredentials||this.options.crossOrigin==="use-credentials")&&this.fileLoader.setWithCredentials(!0)}setExtensions(e){this.extensions=e}setPlugins(e){this.plugins=e}parse(e,t){let n=this,s=this.json,r=this.extensions;this.cache.removeAll(),this.nodeCache={},this._invokeAll(function(a){return a._markDefs&&a._markDefs()}),Promise.all(this._invokeAll(function(a){return a.beforeRoot&&a.beforeRoot()})).then(function(){return Promise.all([n.getDependencies("scene"),n.getDependencies("animation"),n.getDependencies("camera")])}).then(function(a){let o={scene:a[0][s.scene||0],scenes:a[0],animations:a[1],cameras:a[2],asset:s.asset,parser:n,userData:{}};return _s(r,o,s),ni(o,s),Promise.all(n._invokeAll(function(l){return l.afterRoot&&l.afterRoot(o)})).then(function(){for(let l of o.scenes)l.updateMatrixWorld();e(o)})}).catch(t)}_markDefs(){let e=this.json.nodes||[],t=this.json.skins||[],n=this.json.meshes||[];for(let s=0,r=t.length;s<r;s++){let a=t[s].joints;for(let o=0,l=a.length;o<l;o++)e[a[o]].isBone=!0}for(let s=0,r=e.length;s<r;s++){let a=e[s];a.mesh!==void 0&&(this._addNodeRef(this.meshCache,a.mesh),a.skin!==void 0&&(n[a.mesh].isSkinnedMesh=!0)),a.camera!==void 0&&this._addNodeRef(this.cameraCache,a.camera)}}_addNodeRef(e,t){t!==void 0&&(e.refs[t]===void 0&&(e.refs[t]=e.uses[t]=0),e.refs[t]++)}_getNodeRef(e,t,n){if(e.refs[t]<=1)return n;let s=n.clone(),r=(a,o)=>{let l=this.associations.get(a);l!=null&&this.associations.set(o,l);for(let[c,h]of a.children.entries())r(h,o.children[c])};return r(n,s),s.name+="_instance_"+e.uses[t]++,s}_invokeOne(e){let t=Object.values(this.plugins);t.push(this);for(let n=0;n<t.length;n++){let s=e(t[n]);if(s)return s}return null}_invokeAll(e){let t=Object.values(this.plugins);t.unshift(this);let n=[];for(let s=0;s<t.length;s++){let r=e(t[s]);r&&n.push(r)}return n}getDependency(e,t){let n=e+":"+t,s=this.cache.get(n);if(!s){switch(e){case"scene":s=this.loadScene(t);break;case"node":s=this._invokeOne(function(r){return r.loadNode&&r.loadNode(t)});break;case"mesh":s=this._invokeOne(function(r){return r.loadMesh&&r.loadMesh(t)});break;case"accessor":s=this.loadAccessor(t);break;case"bufferView":s=this._invokeOne(function(r){return r.loadBufferView&&r.loadBufferView(t)});break;case"buffer":s=this.loadBuffer(t);break;case"material":s=this._invokeOne(function(r){return r.loadMaterial&&r.loadMaterial(t)});break;case"texture":s=this._invokeOne(function(r){return r.loadTexture&&r.loadTexture(t)});break;case"skin":s=this.loadSkin(t);break;case"animation":s=this._invokeOne(function(r){return r.loadAnimation&&r.loadAnimation(t)});break;case"camera":s=this.loadCamera(t);break;default:if(s=this._invokeOne(function(r){return r!=this&&r.getDependency&&r.getDependency(e,t)}),!s)throw new Error("Unknown type: "+e);break}this.cache.add(n,s)}return s}getDependencies(e){let t=this.cache.get(e);if(!t){let n=this,s=this.json[e+(e==="mesh"?"es":"s")]||[];t=Promise.all(s.map(function(r,a){return n.getDependency(e,a)})),this.cache.add(e,t)}return t}loadBuffer(e){let t=this.json.buffers[e],n=this.fileLoader;if(t.type&&t.type!=="arraybuffer")throw new Error("THREE.GLTFLoader: "+t.type+" buffer type is not supported.");if(t.uri===void 0&&e===0)return Promise.resolve(this.extensions[Ve.KHR_BINARY_GLTF].body);let s=this.options;return new Promise(function(r,a){n.load(bi.resolveURL(t.uri,s.path),r,void 0,function(){a(new Error('THREE.GLTFLoader: Failed to load buffer "'+t.uri+'".'))})})}loadBufferView(e){let t=this.json.bufferViews[e];return this.getDependency("buffer",t.buffer).then(function(n){let s=t.byteLength||0,r=t.byteOffset||0;return n.slice(r,r+s)})}loadAccessor(e){let t=this,n=this.json,s=this.json.accessors[e];if(s.bufferView===void 0&&s.sparse===void 0){let a=Kh[s.type],o=pr[s.componentType],l=s.normalized===!0,c=new o(s.count*a);return Promise.resolve(new Ot(c,a,l))}let r=[];return s.bufferView!==void 0?r.push(this.getDependency("bufferView",s.bufferView)):r.push(null),s.sparse!==void 0&&(r.push(this.getDependency("bufferView",s.sparse.indices.bufferView)),r.push(this.getDependency("bufferView",s.sparse.values.bufferView))),Promise.all(r).then(function(a){let o=a[0],l=Kh[s.type],c=pr[s.componentType],h=c.BYTES_PER_ELEMENT,u=h*l,d=s.byteOffset||0,f=s.bufferView!==void 0?n.bufferViews[s.bufferView].byteStride:void 0,m=s.normalized===!0,b,g;if(f&&f!==u){let p=Math.floor(d/f),x="InterleavedBuffer:"+s.bufferView+":"+s.componentType+":"+p+":"+s.count,w=t.cache.get(x);w||(b=new c(o,p*f,s.count*f/h),w=new Ks(b,f/h),t.cache.add(x,w)),g=new Js(w,l,d%f/h,m)}else o===null?b=new c(s.count*l):b=new c(o,d,s.count*l),g=new Ot(b,l,m);if(s.sparse!==void 0){let p=Kh.SCALAR,x=pr[s.sparse.indices.componentType],w=s.sparse.indices.byteOffset||0,y=s.sparse.values.byteOffset||0,S=new x(a[1],w,s.sparse.count*p),E=new c(a[2],y,s.sparse.count*l);o!==null&&(g=new Ot(g.array.slice(),g.itemSize,g.normalized)),g.normalized=!1;for(let _=0,A=S.length;_<A;_++){let k=S[_];if(g.setX(k,E[_*l]),l>=2&&g.setY(k,E[_*l+1]),l>=3&&g.setZ(k,E[_*l+2]),l>=4&&g.setW(k,E[_*l+3]),l>=5)throw new Error("THREE.GLTFLoader: Unsupported itemSize in sparse BufferAttribute.")}g.normalized=m}return g})}loadTexture(e){let t=this.json,n=this.options,r=t.textures[e].source,a=t.images[r],o=this.textureLoader;if(a.uri){let l=n.manager.getHandler(a.uri);l!==null&&(o=l)}return this.loadTextureImage(e,r,o)}loadTextureImage(e,t,n){let s=this,r=this.json,a=r.textures[e],o=r.images[t],l=(o.uri||o.bufferView)+":"+a.sampler;if(this.textureCache[l])return this.textureCache[l];let c=this.loadImageSource(t,n).then(function(h){h.flipY=!1,h.name=a.name||o.name||"",h.name===""&&typeof o.uri=="string"&&o.uri.startsWith("data:image/")===!1&&(h.name=o.uri);let d=(r.samplers||{})[a.sampler]||{};return h.magFilter=Lp[d.magFilter]||St,h.minFilter=Lp[d.minFilter]||An,h.wrapS=Pp[d.wrapS]||Pi,h.wrapT=Pp[d.wrapT]||Pi,h.generateMipmaps=!h.isCompressedTexture&&h.minFilter!==pt&&h.minFilter!==St,s.associations.set(h,{textures:e}),h}).catch(function(){return null});return this.textureCache[l]=c,c}loadImageSource(e,t){let n=this,s=this.json,r=this.options;if(this.sourceCache[e]!==void 0)return this.sourceCache[e].then(d=>d.clone());let a=s.images[e],o=self.URL||self.webkitURL,l=a.uri||"",c=!1,h;if(t.isKTX2Loader===!0&&a.bufferView!==void 0)h=n.getDependency("bufferView",a.bufferView).then(function(d){return new Promise(function(f,m){t.parse(d,f,m)})});else{if(a.bufferView!==void 0)l=n.getDependency("bufferView",a.bufferView).then(function(d){c=!0;let f=new Blob([d],{type:a.mimeType});return l=o.createObjectURL(f),l});else if(a.uri===void 0)throw new Error("THREE.GLTFLoader: Image "+e+" is missing URI and bufferView");h=Promise.resolve(l).then(function(d){return new Promise(function(f,m){let b=f;t.isImageBitmapLoader===!0&&(b=function(g){let p=new kt(g);p.needsUpdate=!0,f(p)}),t.load(bi.resolveURL(d,r.path),b,void 0,m)})})}let u=h.then(function(d){return c===!0&&o.revokeObjectURL(l),ni(d,a),d.userData.mimeType=a.mimeType||rw(a.uri),d}).catch(function(d){throw console.error("THREE.GLTFLoader: Couldn't load texture",l),d});return this.sourceCache[e]=u,u}assignTexture(e,t,n,s){let r=this;return this.getDependency("texture",n.index).then(function(a){if(!a)return null;if(n.texCoord!==void 0&&n.texCoord>0&&(a=a.clone(),a.channel=n.texCoord),r.extensions[Ve.KHR_TEXTURE_TRANSFORM]){let o=n.extensions!==void 0?n.extensions[Ve.KHR_TEXTURE_TRANSFORM]:void 0;if(o){let l=r.associations.get(a);a=r.extensions[Ve.KHR_TEXTURE_TRANSFORM].extendTexture(a,o),r.associations.set(a,l)}}return s!==void 0&&(a.colorSpace=s),e[t]=a,a})}assignFinalMaterial(e){let t=e.geometry,n=e.material,s=t.attributes.tangent===void 0,r=t.attributes.color!==void 0,a=t.attributes.normal===void 0;if(e.isPoints){let o="PointsMaterial:"+n.uuid,l=this.cache.get(o);l||(l=new er,rn.prototype.copy.call(l,n),l.color.copy(n.color),l.map=n.map,l.sizeAttenuation=!1,this.cache.add(o,l)),n=l}else if(e.isLine){let o="LineBasicMaterial:"+n.uuid,l=this.cache.get(o);l||(l=new Qs,rn.prototype.copy.call(l,n),l.color.copy(n.color),l.map=n.map,this.cache.add(o,l)),n=l}if(s||r||a){let o="ClonedMaterial:"+n.uuid+":";s&&(o+="derivative-tangents:"),r&&(o+="vertex-colors:"),a&&(o+="flat-shading:");let l=this.cache.get(o);l||(l=n.clone(),r&&(l.vertexColors=!0),a&&(l.flatShading=!0),s&&(l.normalScale&&(l.normalScale.y*=-1),l.clearcoatNormalScale&&(l.clearcoatNormalScale.y*=-1)),this.cache.add(o,l),this.associations.set(l,this.associations.get(n))),n=l}e.material=n}getMaterialType(){return os}loadMaterial(e){let t=this,n=this.json,s=this.extensions,r=n.materials[e],a,o={},l=r.extensions||{},c=[];if(l[Ve.KHR_MATERIALS_UNLIT]){let u=s[Ve.KHR_MATERIALS_UNLIT];a=u.getMaterialType(),c.push(u.extendParams(o,r,t))}else{let u=r.pbrMetallicRoughness||{};if(o.color=new Ee(1,1,1),o.opacity=1,Array.isArray(u.baseColorFactor)){let d=u.baseColorFactor;o.color.setRGB(d[0],d[1],d[2],Jt),o.opacity=d[3]}u.baseColorTexture!==void 0&&c.push(t.assignTexture(o,"map",u.baseColorTexture,wt)),o.metalness=u.metallicFactor!==void 0?u.metallicFactor:1,o.roughness=u.roughnessFactor!==void 0?u.roughnessFactor:1,u.metallicRoughnessTexture!==void 0&&(c.push(t.assignTexture(o,"metalnessMap",u.metallicRoughnessTexture)),c.push(t.assignTexture(o,"roughnessMap",u.metallicRoughnessTexture))),a=this._invokeOne(function(d){return d.getMaterialType&&d.getMaterialType(e)}),c.push(Promise.all(this._invokeAll(function(d){return d.extendMaterialParams&&d.extendMaterialParams(e,o)})))}r.doubleSided===!0&&(o.side=on);let h=r.alphaMode||Jh.OPAQUE;if(h===Jh.BLEND?(o.transparent=!0,o.depthWrite=!1):(o.transparent=!1,h===Jh.MASK&&(o.alphaTest=r.alphaCutoff!==void 0?r.alphaCutoff:.5)),r.normalTexture!==void 0&&a!==Sn&&(c.push(t.assignTexture(o,"normalMap",r.normalTexture)),o.normalScale=new Ie(1,1),r.normalTexture.scale!==void 0)){let u=r.normalTexture.scale;o.normalScale.set(u,u)}if(r.occlusionTexture!==void 0&&a!==Sn&&(c.push(t.assignTexture(o,"aoMap",r.occlusionTexture)),r.occlusionTexture.strength!==void 0&&(o.aoMapIntensity=r.occlusionTexture.strength)),r.emissiveFactor!==void 0&&a!==Sn){let u=r.emissiveFactor;o.emissive=new Ee().setRGB(u[0],u[1],u[2],Jt)}return r.emissiveTexture!==void 0&&a!==Sn&&c.push(t.assignTexture(o,"emissiveMap",r.emissiveTexture,wt)),Promise.all(c).then(function(){let u=new a(o);return r.name&&(u.name=r.name),ni(u,r),t.associations.set(u,{materials:e}),r.extensions&&_s(s,u,r),u})}createUniqueName(e){let t=tt.sanitizeNodeName(e||"");return t in this.nodeNamesUsed?t+"_"+ ++this.nodeNamesUsed[t]:(this.nodeNamesUsed[t]=0,t)}loadGeometries(e){let t=this,n=this.extensions,s=this.primitiveCache;function r(o){return n[Ve.KHR_DRACO_MESH_COMPRESSION].decodePrimitive(o,t).then(function(l){return Ip(l,o,t)})}let a=[];for(let o=0,l=e.length;o<l;o++){let c=e[o],h=sw(c),u=s[h];if(u)a.push(u.promise);else{let d;c.extensions&&c.extensions[Ve.KHR_DRACO_MESH_COMPRESSION]?d=r(c):d=Ip(new $t,c,t),c.mode===Tn.TRIANGLE_STRIP?d=d.then(f=>Yh(f,fa)):c.mode===Tn.TRIANGLE_FAN&&(d=d.then(f=>Yh(f,ur))),s[h]={primitive:c,promise:d},a.push(d)}}return Promise.all(a)}loadMesh(e){let t=this,n=this.json,s=this.extensions,r=n.meshes[e],a=r.primitives,o=[];for(let l=0,c=a.length;l<c;l++){let h=a[l].material===void 0?tw(this.cache):this.getDependency("material",a[l].material);o.push(h)}return o.push(t.loadGeometries(a)),Promise.all(o).then(async function(l){let c=l.slice(0,l.length-1),h=l[l.length-1],u=[];for(let f=0,m=h.length;f<m;f++){let b=h[f],g=a[f],p,x=c[f];if(g.mode===Tn.TRIANGLES||g.mode===Tn.TRIANGLE_STRIP||g.mode===Tn.TRIANGLE_FAN||g.mode===void 0){let w=r.isSkinnedMesh===!0,y=b.hasAttribute("skinIndex")&&b.hasAttribute("skinWeight");w&&y===!1&&console.warn("THREE.GLTFLoader: Missing skinIndex or skinWeight attributes. Skinning disabled."),p=w&&y?new ss(b,x):new Bt(b,x),p.isSkinnedMesh===!0&&p.normalizeSkinWeights()}else if(g.mode===Tn.LINES)p=new Vr(b,x);else if(g.mode===Tn.LINE_STRIP)p=new as(b,x);else if(g.mode===Tn.LINE_LOOP)p=new Wr(b,x);else if(g.mode===Tn.POINTS)p=new qr(b,x);else throw new Error("THREE.GLTFLoader: Primitive mode unsupported: "+g.mode);Object.keys(p.geometry.morphAttributes).length>0&&iw(p,r),p.name=t.createUniqueName(r.name||"mesh_"+e),ni(p,r),g.extensions&&_s(s,p,g),t.assignFinalMaterial(p),u.push(p)}for(let f=0,m=u.length;f<m;f++)t.associations.set(u[f],{meshes:e,primitives:f});if(u.length===1)return r.extensions&&_s(s,u[0],r),u[0];let d=new Pt;r.extensions&&_s(s,d,r),t.associations.set(d,{meshes:e});for(let f=0,m=u.length;f<m;f++)d.add(u[f]);return d})}loadCamera(e){let t,n=this.json.cameras[e],s=n[n.type];if(!s){console.warn("THREE.GLTFLoader: Missing camera parameters.");return}return n.type==="perspective"?t=new Mt(dt.radToDeg(s.yfov),s.aspectRatio||1,s.znear||1,s.zfar||2e6):n.type==="orthographic"&&(t=new Kn(-s.xmag,s.xmag,s.ymag,-s.ymag,s.znear,s.zfar)),n.name&&(t.name=this.createUniqueName(n.name)),ni(t,n),Promise.resolve(t)}loadSkin(e){let t=this.json.skins[e],n=[];for(let s=0,r=t.joints.length;s<r;s++)n.push(this._loadNodeShallow(t.joints[s]));return t.inverseBindMatrices!==void 0?n.push(this.getDependency("accessor",t.inverseBindMatrices)):n.push(null),Promise.all(n).then(function(s){let r=s.pop(),a=s,o=[],l=[];for(let c=0,h=a.length;c<h;c++){let u=a[c];if(u){o.push(u);let d=new ke;r!==null&&d.fromArray(r.array,c*16),l.push(d)}else console.warn('THREE.GLTFLoader: Joint "%s" could not be found.',t.joints[c])}return new rs(o,l)})}loadAnimation(e){let t=this.json,n=this,s=t.animations[e],r=s.name?s.name:"animation_"+e,a=[],o=[],l=[],c=[],h=[];for(let u=0,d=s.channels.length;u<d;u++){let f=s.channels[u],m=s.samplers[f.sampler],b=f.target,g=b.node,p=s.parameters!==void 0?s.parameters[m.input]:m.input,x=s.parameters!==void 0?s.parameters[m.output]:m.output;b.node!==void 0&&(a.push(this.getDependency("node",g)),o.push(this.getDependency("accessor",p)),l.push(this.getDependency("accessor",x)),c.push(m),h.push(b))}return Promise.all([Promise.all(a),Promise.all(o),Promise.all(l),Promise.all(c),Promise.all(h)]).then(function(u){let d=u[0],f=u[1],m=u[2],b=u[3],g=u[4],p=[];for(let w=0,y=d.length;w<y;w++){let S=d[w],E=f[w],_=m[w],A=b[w],k=g[w];if(S===void 0)continue;S.updateMatrix&&S.updateMatrix();let R=n._createAnimationTracks(S,E,_,A,k);if(R)for(let D=0;D<R.length;D++)p.push(R[D])}let x=new Qt(r,void 0,p);return ni(x,s),x})}createNodeMesh(e){let t=this.json,n=this,s=t.nodes[e];return s.mesh===void 0?null:n.getDependency("mesh",s.mesh).then(function(r){let a=n._getNodeRef(n.meshCache,s.mesh,r);return s.weights!==void 0&&a.traverse(function(o){if(o.isMesh)for(let l=0,c=s.weights.length;l<c;l++)o.morphTargetInfluences[l]=s.weights[l]}),a})}loadNode(e){let t=this.json,n=this,s=t.nodes[e],r=n._loadNodeShallow(e),a=[],o=s.children||[];for(let c=0,h=o.length;c<h;c++)a.push(n.getDependency("node",o[c]));let l=s.skin===void 0?Promise.resolve(null):n.getDependency("skin",s.skin);return Promise.all([r,Promise.all(a),l]).then(function(c){let h=c[0],u=c[1],d=c[2];d!==null&&h.traverse(function(f){f.isSkinnedMesh&&f.bind(d,aw)});for(let f=0,m=u.length;f<m;f++)h.add(u[f]);if(h.userData.pivot!==void 0&&u.length>0){let f=h.userData.pivot,m=u[0];h.pivot=new L().fromArray(f),h.position.x-=f[0],h.position.y-=f[1],h.position.z-=f[2],m.position.set(0,0,0),delete h.userData.pivot}return h})}_loadNodeShallow(e){let t=this.json,n=this.extensions,s=this;if(this.nodeCache[e]!==void 0)return this.nodeCache[e];let r=t.nodes[e],a=r.name?s.createUniqueName(r.name):"",o=[],l=s._invokeOne(function(c){return c.createNodeMesh&&c.createNodeMesh(e)});return l&&o.push(l),r.camera!==void 0&&o.push(s.getDependency("camera",r.camera).then(function(c){return s._getNodeRef(s.cameraCache,r.camera,c)})),s._invokeAll(function(c){return c.createNodeAttachment&&c.createNodeAttachment(e)}).forEach(function(c){o.push(c)}),this.nodeCache[e]=Promise.all(o).then(function(c){let h;if(r.isBone===!0?h=new $s:c.length>1?h=new Pt:c.length===1?h=c[0]:h=new nt,h!==c[0])for(let u=0,d=c.length;u<d;u++)h.add(c[u]);if(r.name&&(h.userData.name=r.name,h.name=a),ni(h,r),r.extensions&&_s(n,h,r),r.matrix!==void 0){let u=new ke;u.fromArray(r.matrix),h.applyMatrix4(u)}else r.translation!==void 0&&h.position.fromArray(r.translation),r.rotation!==void 0&&h.quaternion.fromArray(r.rotation),r.scale!==void 0&&h.scale.fromArray(r.scale);if(!s.associations.has(h))s.associations.set(h,{});else if(r.mesh!==void 0&&s.meshCache.refs[r.mesh]>1){let u=s.associations.get(h);s.associations.set(h,{...u})}return s.associations.get(h).nodes=e,h}),this.nodeCache[e]}loadScene(e){let t=this.extensions,n=this.json.scenes[e],s=this,r=new Pt;n.name&&(r.name=s.createUniqueName(n.name)),ni(r,n),n.extensions&&_s(t,r,n);let a=n.nodes||[],o=[];for(let l=0,c=a.length;l<c;l++)o.push(s.getDependency("node",a[l]));return Promise.all(o).then(function(l){for(let h=0,u=l.length;h<u;h++){let d=l[h];d.parent!==null?r.add(Ep(d)):r.add(d)}let c=h=>{let u=new Map;for(let[d,f]of s.associations)(d instanceof rn||d instanceof kt)&&u.set(d,f);return h.traverse(d=>{let f=s.associations.get(d);f!=null&&u.set(d,f)}),u};return s.associations=c(r),r})}_createAnimationTracks(e,t,n,s,r){let a=[],o=e.name?e.name:e.uuid,l=[];function c(f){f.morphTargetInfluences&&l.push(f.name?f.name:f.uuid)}zi[r.path]===zi.weights?(c(e),e.isGroup&&e.children.forEach(c)):l.push(o);let h;switch(zi[r.path]){case zi.weights:h=Un;break;case zi.rotation:h=On;break;case zi.translation:case zi.scale:h=Di;break;default:n.itemSize===1?h=Un:h=Di;break}let u=s.interpolation!==void 0?ew[s.interpolation]:ts,d=this._getArrayFromAccessor(n);for(let f=0,m=l.length;f<m;f++){let b=new h(l[f]+"."+zi[r.path],t.array,d,u);s.interpolation==="CUBICSPLINE"&&this._createCubicSplineTrackInterpolant(b),a.push(b)}return a}_getArrayFromAccessor(e){let t=e.array;if(e.normalized){let n=wu(t.constructor),s=new Float32Array(t.length);for(let r=0,a=t.length;r<a;r++)s[r]=t[r]*n;t=s}return t}_createCubicSplineTrackInterpolant(e){e.createInterpolant=function(n){let s=this instanceof On?yu:Nl;return new s(this.times,this.values,this.getValueSize()/3,n)},e.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline=!0}}});var Np={};La(Np,{MeshoptDecoder:()=>lw});var lw,Fp=rt(()=>{lw=(function(){var i="b9H79Tebbbe8Fv9Gbb9Gvuuuuueu9Giuuub9Geueu9Giuuueuixkbeeeddddillviebeoweuecj:Gdkr;Neqo9TW9T9VV95dbH9F9F939H79T9F9J9H229F9Jt9VV7bb8A9TW79O9V9Wt9F9KW9J9V9KW9wWVtW949c919M9MWVbeY9TW79O9V9Wt9F9KW9J9V9KW69U9KW949c919M9MWVbdE9TW79O9V9Wt9F9KW9J9V9KW69U9KW949tWG91W9U9JWbiL9TW79O9V9Wt9F9KW9J9V9KWS9P2tWV9p9JtblK9TW79O9V9Wt9F9KW9J9V9KWS9P2tWV9r919HtbvL9TW79O9V9Wt9F9KW9J9V9KWS9P2tWVT949WboY9TW79O9V9Wt9F9KW9J9V9KWS9P2tWVJ9V29VVbrl79IV9Rbwq:VZkdbk:XYi5ud9:du8Jjjjjbcj;kb9Rgv8Kjjjjbc9:hodnalTmbcuhoaiRbbgrc;WeGc:Ge9hmbarcsGgwce0mbc9:hoalcufadcd4cbawEgDadfgrcKcaawEgqaraq0Egk6mbaicefhxcj;abad9Uc;WFbGcjdadca0EhmaialfgPar9Rgoadfhsavaoadz:jjjjbgzceVhHcbhOdndninaeaO9nmeaPax9RaD6mdamaeaO9RaOamfgoae6EgAcsfglc9WGhCabaOad2fhXaAcethQaxaDfhiaOaeaoaeao6E9RhLalcl4cifcd4hKazcj;cbfaAfhYcbh8AazcjdfhEaHh3incbh5dnawTmbaxa8Acd4fRbbh5kcbh8Eazcj;cbfhqinaih8Fdndndndna5a8Ecet4ciGgoc9:fPdebdkaPa8F9RaA6mrazcj;cbfa8EaA2fa8FaAz:jjjjb8Aa8FaAfhixdkazcj;cbfa8EaA2fcbaAz:kjjjb8Aa8FhixekaPa8F9RaK6mva8FaKfhidnaCTmbaPai9RcK6mbaocdtc:q:G:cjbfcj:G:cjbawEhaczhrcbhlinargoc9Wfghaqfhrdndndndndndnaaa8Fahco4fRbbalcoG4ciGcdtfydbPDbedvivvvlvkar9cb83bwar9cb83bbxlkarcbaiRbdai8Xbb9c:c:qj:bw9:9c:q;c1:I1e:d9c:b:c:e1z9:gg9cjjjjjz:dg8J9qE86bbaqaofgrcGfcbaicdfa8J9c8N1:NfghRbbag9cjjjjjw:dg8J9qE86bbarcVfcbaha8J9c8M1:NfghRbbag9cjjjjjl:dg8J9qE86bbarc7fcbaha8J9c8L1:NfghRbbag9cjjjjjd:dg8J9qE86bbarctfcbaha8J9c8K1:NfghRbbag9cjjjjje:dg8J9qE86bbarc91fcbaha8J9c8J1:NfghRbbag9cjjjj;ab:dg8J9qE86bbarc4fcbaha8J9cg1:NfghRbbag9cjjjja:dg8J9qE86bbarc93fcbaha8J9ch1:NfghRbbag9cjjjjz:dgg9qE86bbarc94fcbahag9ca1:NfghRbbai8Xbe9c:c:qj:bw9:9c:q;c1:I1e:d9c:b:c:e1z9:gg9cjjjjjz:dg8J9qE86bbarc95fcbaha8J9c8N1:NfgiRbbag9cjjjjjw:dg8J9qE86bbarc96fcbaia8J9c8M1:NfgiRbbag9cjjjjjl:dg8J9qE86bbarc97fcbaia8J9c8L1:NfgiRbbag9cjjjjjd:dg8J9qE86bbarc98fcbaia8J9c8K1:NfgiRbbag9cjjjjje:dg8J9qE86bbarc99fcbaia8J9c8J1:NfgiRbbag9cjjjj;ab:dg8J9qE86bbarc9:fcbaia8J9cg1:NfgiRbbag9cjjjja:dg8J9qE86bbarcufcbaia8J9ch1:NfgiRbbag9cjjjjz:dgg9qE86bbaiag9ca1:NfhixikaraiRblaiRbbghco4g8Ka8KciSg8KE86bbaqaofgrcGfaiclfa8Kfg8KRbbahcl4ciGg8La8LciSg8LE86bbarcVfa8Ka8Lfg8KRbbahcd4ciGg8La8LciSg8LE86bbarc7fa8Ka8Lfg8KRbbahciGghahciSghE86bbarctfa8Kahfg8KRbbaiRbeghco4g8La8LciSg8LE86bbarc91fa8Ka8Lfg8KRbbahcl4ciGg8La8LciSg8LE86bbarc4fa8Ka8Lfg8KRbbahcd4ciGg8La8LciSg8LE86bbarc93fa8Ka8Lfg8KRbbahciGghahciSghE86bbarc94fa8Kahfg8KRbbaiRbdghco4g8La8LciSg8LE86bbarc95fa8Ka8Lfg8KRbbahcl4ciGg8La8LciSg8LE86bbarc96fa8Ka8Lfg8KRbbahcd4ciGg8La8LciSg8LE86bbarc97fa8Ka8Lfg8KRbbahciGghahciSghE86bbarc98fa8KahfghRbbaiRbigico4g8Ka8KciSg8KE86bbarc99faha8KfghRbbaicl4ciGg8Ka8KciSg8KE86bbarc9:faha8KfghRbbaicd4ciGg8Ka8KciSg8KE86bbarcufaha8KfgrRbbaiciGgiaiciSgiE86bbaraifhixdkaraiRbwaiRbbghcl4g8Ka8KcsSg8KE86bbaqaofgrcGfaicwfa8Kfg8KRbbahcsGghahcsSghE86bbarcVfa8KahfghRbbaiRbeg8Kcl4g8La8LcsSg8LE86bbarc7faha8LfghRbba8KcsGg8Ka8KcsSg8KE86bbarctfaha8KfghRbbaiRbdg8Kcl4g8La8LcsSg8LE86bbarc91faha8LfghRbba8KcsGg8Ka8KcsSg8KE86bbarc4faha8KfghRbbaiRbig8Kcl4g8La8LcsSg8LE86bbarc93faha8LfghRbba8KcsGg8Ka8KcsSg8KE86bbarc94faha8KfghRbbaiRblg8Kcl4g8La8LcsSg8LE86bbarc95faha8LfghRbba8KcsGg8Ka8KcsSg8KE86bbarc96faha8KfghRbbaiRbvg8Kcl4g8La8LcsSg8LE86bbarc97faha8LfghRbba8KcsGg8Ka8KcsSg8KE86bbarc98faha8KfghRbbaiRbog8Kcl4g8La8LcsSg8LE86bbarc99faha8LfghRbba8KcsGg8Ka8KcsSg8KE86bbarc9:faha8KfghRbbaiRbrgicl4g8Ka8KcsSg8KE86bbarcufaha8KfgrRbbaicsGgiaicsSgiE86bbaraifhixekarai8Pbw83bwarai8Pbb83bbaiczfhikdnaoaC9pmbalcdfhlaoczfhraPai9RcL0mekkaoaC6moaimexokaCmva8FTmvkaqaAfhqa8Ecefg8Ecl9hmbkdndndndnawTmbasa8Acd4fRbbgociGPlbedrbkaATmdaza8Afh8Fazcj;cbfhhcbh8EaEhaina8FRbbhraahocbhlinaoahalfRbbgqce4cbaqceG9R7arfgr86bbaoadfhoaAalcefgl9hmbkaacefhaa8Fcefh8FahaAfhha8Ecefg8Ecl9hmbxikkaATmeaza8Afhaazcj;cbfhhcbhoceh8EaYh8FinaEaofhlaa8Vbbhrcbhoinala8FaofRbbcwtahaofRbbgqVc;:FiGce4cbaqceG9R7arfgr87bbaladfhlaLaocefgofmbka8FaQfh8FcdhoaacdfhaahaQfhha8EceGhlcbh8EalmbxdkkaATmbaocl4h8Eaza8AfRbbhqcwhoa3hlinalRbbaotaqVhqalcefhlaocwfgoca9hmbkcbhhaEh8FaYhainazcj;cbfahfRbbhrcwhoaahlinalRbbaotarVhralaAfhlaocwfgoca9hmbkara8E94aq7hqcbhoa8Fhlinalaqao486bbalcefhlaocwfgoca9hmbka8Fadfh8FaacefhaahcefghaA9hmbkkaEclfhEa3clfh3a8Aclfg8Aad6mbkaXazcjdfaAad2z:jjjjb8AazazcjdfaAcufad2fadz:jjjjb8AaAaOfhOaihxaimbkc9:hoxdkcbc99aPax9RakSEhoxekc9:hokavcj;kbf8Kjjjjbaok:ysezu8Jjjjjbc;ae9Rgv8Kjjjjbc9:hodnalaeci9UgrcHf6mbcuhoaiRbbgwc;WeGc;Ge9hmbawcsGgDce0mbavc;abfcFecjez:kjjjb8Aav9cu83iUav9cu83i8Wav9cu83iyav9cu83iaav9cu83iKav9cu83izav9cu83iwav9cu83ibaialfc9WfhqaicefgwarfhldnaeTmbcmcsaDceSEhkcbhxcbhmcbhrcbhicbhoindnalaq9nmbc9:hoxikdndnawRbbgDc;Ve0mbavc;abfaoaDcu7gPcl4fcsGcitfgsydlhzasydbhHdndnaDcsGgsak9pmbavaiaPfcsGcdtfydbaxasEhDaxasTgOfhxxekdndnascsSmbcehOasc987asamffcefhDxekalcefhDal8SbbgscFeGhPdndnascu9mmbaDhlxekalcvfhlaPcFbGhPcrhsdninaD8SbbgOcFbGastaPVhPaOcu9kmeaDcefhDascrfgsc8J9hmbxdkkaDcefhlkcehOaPce4cbaPceG9R7amfhDkaDhmkavc;abfaocitfgsaDBdbasazBdlavaicdtfaDBdbavc;abfaocefcsGcitfgsaHBdbasaDBdlaocdfhoaOaifhidnadcd9hmbabarcetfgsaH87ebasclfaD87ebascdfaz87ebxdkabarcdtfgsaHBdbascwfaDBdbasclfazBdbxekdnaDcpe0mbavaiaqaDcsGfRbbgscl4gP9RcsGcdtfydbaxcefgOaPEhDavaias9RcsGcdtfydbaOaPTgzfgOascsGgPEhsaPThPdndnadcd9hmbabarcetfgHax87ebaHclfas87ebaHcdfaD87ebxekabarcdtfgHaxBdbaHcwfasBdbaHclfaDBdbkavaicdtfaxBdbavc;abfaocitfgHaDBdbaHaxBdlavaicefgicsGcdtfaDBdbavc;abfaocefcsGcitfgHasBdbaHaDBdlavaiazfgicsGcdtfasBdbavc;abfaocdfcsGcitfgDaxBdbaDasBdlaocifhoaiaPfhiaOaPfhxxekaxcbalRbbgsEgHaDc;:eSgDfhOascsGhAdndnascl4gCmbaOcefhzxekaOhzavaiaC9RcsGcdtfydbhOkdndnaAmbazcefhxxekazhxavaias9RcsGcdtfydbhzkdndnaDTmbalcefhDxekalcdfhDal8SbegPcFeGhsdnaPcu9kmbalcofhHascFbGhscrhldninaD8SbbgPcFbGaltasVhsaPcu9kmeaDcefhDalcrfglc8J9hmbkaHhDxekaDcefhDkasce4cbasceG9R7amfgmhHkdndnaCcsSmbaDhsxekaDcefhsaD8SbbglcFeGhPdnalcu9kmbaDcvfhOaPcFbGhPcrhldninas8SbbgDcFbGaltaPVhPaDcu9kmeascefhsalcrfglc8J9hmbkaOhsxekascefhskaPce4cbaPceG9R7amfgmhOkdndnaAcsSmbashlxekascefhlas8SbbgDcFeGhPdnaDcu9kmbascvfhzaPcFbGhPcrhDdninal8SbbgscFbGaDtaPVhPascu9kmealcefhlaDcrfgDc8J9hmbkazhlxekalcefhlkaPce4cbaPceG9R7amfgmhzkdndnadcd9hmbabarcetfgDaH87ebaDclfaz87ebaDcdfaO87ebxekabarcdtfgDaHBdbaDcwfazBdbaDclfaOBdbkavc;abfaocitfgDaOBdbaDaHBdlavaicdtfaHBdbavc;abfaocefcsGcitfgDazBdbaDaOBdlavaicefgicsGcdtfaOBdbavc;abfaocdfcsGcitfgDaHBdbaDazBdlavaiaCTaCcsSVfgicsGcdtfazBdbaiaATaAcsSVfhiaocifhokawcefhwaocsGhoaicsGhiarcifgrae6mbkkcbc99alaqSEhokavc;aef8Kjjjjbaok:clevu8Jjjjjbcz9Rhvdnalaecvf9pmbc9:skdnaiRbbc;:eGc;qeSmbcuskav9cb83iwaicefhoaialfc98fhrdnaeTmbdnadcdSmbcbhwindnaoar6mbc9:skaocefhlao8SbbgicFeGhddndnaicu9mmbalhoxekaocvfhoadcFbGhdcrhidninal8SbbgDcFbGaitadVhdaDcu9kmealcefhlaicrfgic8J9hmbxdkkalcefhokabawcdtfadc8Etc8F91adcd47avcwfadceGcdtVglydbfgiBdbalaiBdbawcefgwae9hmbxdkkcbhwindnaoar6mbc9:skaocefhlao8SbbgicFeGhddndnaicu9mmbalhoxekaocvfhoadcFbGhdcrhidninal8SbbgDcFbGaitadVhdaDcu9kmealcefhlaicrfgic8J9hmbxdkkalcefhokabawcetfadc8Etc8F91adcd47avcwfadceGcdtVglydbfgi87ebalaiBdbawcefgwae9hmbkkcbc99aoarSEk:Lvoeue99dud99eud99dndnadcl9hmbaeTmeindndnabcdfgd8Sbb:Yab8Sbbgi:Ygl:l:tabcefgv8Sbbgo:Ygr:l:tgwJbb;:9cawawNJbbbbawawJbbbb9GgDEgq:mgkaqaicb9iEalMgwawNakaqaocb9iEarMgqaqNMM:r:vglNJbbbZJbbb:;aDEMgr:lJbbb9p9DTmbar:Ohixekcjjjj94hikadai86bbdndnaqalNJbbbZJbbb:;aqJbbbb9GEMgq:lJbbb9p9DTmbaq:Ohdxekcjjjj94hdkavad86bbdndnawalNJbbbZJbbb:;awJbbbb9GEMgw:lJbbb9p9DTmbaw:Ohdxekcjjjj94hdkabad86bbabclfhbaecufgembxdkkaeTmbindndnabclfgd8Ueb:Yab8Uebgi:Ygl:l:tabcdfgv8Uebgo:Ygr:l:tgwJb;:FSawawNJbbbbawawJbbbb9GgDEgq:mgkaqaicb9iEalMgwawNakaqaocb9iEarMgqaqNMM:r:vglNJbbbZJbbb:;aDEMgr:lJbbb9p9DTmbar:Ohixekcjjjj94hikadai87ebdndnaqalNJbbbZJbbb:;aqJbbbb9GEMgq:lJbbb9p9DTmbaq:Ohdxekcjjjj94hdkavad87ebdndnawalNJbbbZJbbb:;awJbbbb9GEMgw:lJbbb9p9DTmbaw:Ohdxekcjjjj94hdkabad87ebabcwfhbaecufgembkkk:4ioiue99dud99dud99dnaeTmbcbhiabhlindndnal8Uebgv:YgoJ:ji:1Salcof8UebgrciVgw:Y:vgDNJbbbZJbbb:;avcu9kEMgq:lJbbb9p9DTmbaq:Ohkxekcjjjj94hkkalclf8Uebhvalcdf8UebhxalarcefciGcetfak87ebdndnax:YgqaDNJbbbZJbbb:;axcu9kEMgm:lJbbb9p9DTmbam:Ohxxekcjjjj94hxkabaiarciGgkfcd7cetfax87ebdndnav:YgmaDNJbbbZJbbb:;avcu9kEMgP:lJbbb9p9DTmbaP:Ohvxekcjjjj94hvkalarcufciGcetfav87ebdndnawaw2:ZgPaPMaoaoN:taqaqN:tamamN:tgoJbbbbaoJbbbb9GE:raDNJbbbZMgD:lJbbb9p9DTmbaD:Ohrxekcjjjj94hrkalakcetfar87ebalcwfhlaiclfhiaecufgembkkk9mbdnadcd4ae2gdTmbinababydbgecwtcw91:Yaece91cjjj98Gcjjj;8if::NUdbabclfhbadcufgdmbkkk:Tvirud99eudndnadcl9hmbaeTmeindndnabRbbgiabcefgl8Sbbgvabcdfgo8Sbbgrf9R:YJbbuJabcifgwRbbgdce4adVgDcd4aDVgDcl4aDVgD:Z:vgqNJbbbZMgk:lJbbb9p9DTmbak:Ohxxekcjjjj94hxkaoax86bbdndnaraif:YaqNJbbbZMgk:lJbbb9p9DTmbak:Ohoxekcjjjj94hokalao86bbdndnavaifar9R:YaqNJbbbZMgk:lJbbb9p9DTmbak:Ohixekcjjjj94hikabai86bbdndnaDadcetGadceGV:ZaqNJbbbZMgq:lJbbb9p9DTmbaq:Ohdxekcjjjj94hdkawad86bbabclfhbaecufgembxdkkaeTmbindndnab8Vebgiabcdfgl8Uebgvabclfgo8Uebgrf9R:YJbFu9habcofgw8Vebgdce4adVgDcd4aDVgDcl4aDVgDcw4aDVgD:Z:vgqNJbbbZMgk:lJbbb9p9DTmbak:Ohxxekcjjjj94hxkaoax87ebdndnaraif:YaqNJbbbZMgk:lJbbb9p9DTmbak:Ohoxekcjjjj94hokalao87ebdndnavaifar9R:YaqNJbbbZMgk:lJbbb9p9DTmbak:Ohixekcjjjj94hikabai87ebdndnaDadcetGadceGV:ZaqNJbbbZMgq:lJbbb9p9DTmbaq:Ohdxekcjjjj94hdkawad87ebabcwfhbaecufgembkkk9teiucbcbyd:K:G:cjbgeabcifc98GfgbBd:K:G:cjbdndnabZbcztgd9nmbcuhiabad9RcFFifcz4nbcuSmekaehikaik;LeeeudndnaeabVciGTmbabhixekdndnadcz9pmbabhixekabhiinaiaeydbBdbaiclfaeclfydbBdbaicwfaecwfydbBdbaicxfaecxfydbBdbaeczfheaiczfhiadc9Wfgdcs0mbkkadcl6mbinaiaeydbBdbaeclfheaiclfhiadc98fgdci0mbkkdnadTmbinaiaeRbb86bbaicefhiaecefheadcufgdmbkkabk;aeedudndnabciGTmbabhixekaecFeGc:b:c:ew2hldndnadcz9pmbabhixekabhiinaialBdbaicxfalBdbaicwfalBdbaiclfalBdbaiczfhiadc9Wfgdcs0mbkkadcl6mbinaialBdbaiclfhiadc98fgdci0mbkkdnadTmbinaiae86bbaicefhiadcufgdmbkkabkk83dbcj:Gdk8Kbbbbdbbblbbbwbbbbbbbebbbdbbblbbbwbbbbc:K:Gdkl8W:qbb",e="b9H79TebbbeKl9Gbb9Gvuuuuueu9Giuuub9Geueuixkbbebeeddddilve9Weeeviebeoweuecj:Gdkr;Neqo9TW9T9VV95dbH9F9F939H79T9F9J9H229F9Jt9VV7bb8A9TW79O9V9Wt9F9KW9J9V9KW9wWVtW949c919M9MWVbdY9TW79O9V9Wt9F9KW9J9V9KW69U9KW949c919M9MWVblE9TW79O9V9Wt9F9KW9J9V9KW69U9KW949tWG91W9U9JWbvL9TW79O9V9Wt9F9KW9J9V9KWS9P2tWV9p9JtboK9TW79O9V9Wt9F9KW9J9V9KWS9P2tWV9r919HtbrL9TW79O9V9Wt9F9KW9J9V9KWS9P2tWVT949WbwY9TW79O9V9Wt9F9KW9J9V9KWS9P2tWVJ9V29VVbDl79IV9Rbqq:W9Dklbzik94evu8Jjjjjbcz9Rhbcbheincbhdcbhiinabcwfadfaicjuaead4ceGglE86bbaialfhiadcefgdcw9hmbkaeai86b:q:W:cjbaecitab8Piw83i:q:G:cjbaecefgecjd9hmbkk:JBl8Aud97dur978Jjjjjbcj;kb9Rgv8Kjjjjbc9:hodnalTmbcuhoaiRbbgrc;WeGc:Ge9hmbarcsGgwce0mbc9:hoalcufadcd4cbawEgDadfgrcKcaawEgqaraq0Egk6mbaialfgxar9RhodnadTgmmbavaoad;8qbbkaicefhPcj;abad9Uc;WFbGcjdadca0EhsdndndnadTmbaoadfhzcbhHinaeaH9nmdaxaP9RaD6miabaHad2fhOaPaDfhAasaeaH9RaHasfae6EgCcsfgocl4cifcd4hXavcj;cbfaoc9WGgQcetfhLavcj;cbfaQci2fhKavcj;cbfaQfhYcbh8Aaoc;ab6hEincbh3dnawTmbaPa8Acd4fRbbh3kcbh5avcj;cbfh8Eindndndndna3a5cet4ciGgoc9:fPdebdkaxaA9RaQ6mwdnaQTmbavcj;cbfa5aQ2faAaQ;8qbbkaAaCfhAxdkaQTmeavcj;cbfa5aQ2fcbaQ;8kbxekaxaA9RaX6moaoclVcbawEhraAaXfhocbhidnaEmbaxao9Rc;Gb6mbcbhlina8EalfhidndndndndndnaAalco4fRbbgqciGarfPDbedibledibkaipxbbbbbbbbbbbbbbbbpklbxlkaiaopbblaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLg8Fcdp:mea8FpmbzeHdOiAlCvXoQrLpxiiiiiiiiiiiiiiiip9ogapxiiiiiiiiiiiiiiiip8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Nghcitpbi:q:G:cjbahRb:q:W:cjbghpsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Nggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spklbahaoclffagRb:q:W:cjbfhoxikaiaopbbwaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLpxssssssssssssssssp9ogapxssssssssssssssssp8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Nghcitpbi:q:G:cjbahRb:q:W:cjbghpsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Nggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spklbahaocwffagRb:q:W:cjbfhoxdkaiaopbbbpklbaoczfhoxekaiaopbbdaoRbbghcitpbi:q:G:cjbahRb:q:W:cjbghpsaoRbeggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPpklbahaocdffagRb:q:W:cjbfhokdndndndndndnaqcd4ciGarfPDbedibledibkaiczfpxbbbbbbbbbbbbbbbbpklbxlkaiczfaopbblaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLg8Fcdp:mea8FpmbzeHdOiAlCvXoQrLpxiiiiiiiiiiiiiiiip9ogapxiiiiiiiiiiiiiiiip8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Nghcitpbi:q:G:cjbahRb:q:W:cjbghpsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Nggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spklbahaoclffagRb:q:W:cjbfhoxikaiczfaopbbwaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLpxssssssssssssssssp9ogapxssssssssssssssssp8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Nghcitpbi:q:G:cjbahRb:q:W:cjbghpsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Nggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spklbahaocwffagRb:q:W:cjbfhoxdkaiczfaopbbbpklbaoczfhoxekaiczfaopbbdaoRbbghcitpbi:q:G:cjbahRb:q:W:cjbghpsaoRbeggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPpklbahaocdffagRb:q:W:cjbfhokdndndndndndnaqcl4ciGarfPDbedibledibkaicafpxbbbbbbbbbbbbbbbbpklbxlkaicafaopbblaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLg8Fcdp:mea8FpmbzeHdOiAlCvXoQrLpxiiiiiiiiiiiiiiiip9ogapxiiiiiiiiiiiiiiiip8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Nghcitpbi:q:G:cjbahRb:q:W:cjbghpsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Nggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spklbahaoclffagRb:q:W:cjbfhoxikaicafaopbbwaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLpxssssssssssssssssp9ogapxssssssssssssssssp8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Nghcitpbi:q:G:cjbahRb:q:W:cjbghpsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Nggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spklbahaocwffagRb:q:W:cjbfhoxdkaicafaopbbbpklbaoczfhoxekaicafaopbbdaoRbbghcitpbi:q:G:cjbahRb:q:W:cjbghpsaoRbeggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPpklbahaocdffagRb:q:W:cjbfhokdndndndndndnaqco4arfPDbedibledibkaic8Wfpxbbbbbbbbbbbbbbbbpklbxlkaic8Wfaopbblaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLg8Fcdp:mea8FpmbzeHdOiAlCvXoQrLpxiiiiiiiiiiiiiiiip9ogapxiiiiiiiiiiiiiiiip8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Ngicitpbi:q:G:cjbaiRb:q:W:cjbgipsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Ngqcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spklbaiaoclffaqRb:q:W:cjbfhoxikaic8Wfaopbbwaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLpxssssssssssssssssp9ogapxssssssssssssssssp8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Ngicitpbi:q:G:cjbaiRb:q:W:cjbgipsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Ngqcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spklbaiaocwffaqRb:q:W:cjbfhoxdkaic8Wfaopbbbpklbaoczfhoxekaic8WfaopbbdaoRbbgicitpbi:q:G:cjbaiRb:q:W:cjbgipsaoRbegqcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPpklbaiaocdffaqRb:q:W:cjbfhokalc;abfhialcjefaQ0meaihlaxao9Rc;Fb0mbkkdnaiaQ9pmbaici4hlinaxao9RcK6mwa8EaifhqdndndndndndnaAaico4fRbbalcoG4ciGarfPDbedibledibkaqpxbbbbbbbbbbbbbbbbpkbbxlkaqaopbblaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLg8Fcdp:mea8FpmbzeHdOiAlCvXoQrLpxiiiiiiiiiiiiiiiip9ogapxiiiiiiiiiiiiiiiip8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Nghcitpbi:q:G:cjbahRb:q:W:cjbghpsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Nggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spkbbahaoclffagRb:q:W:cjbfhoxikaqaopbbwaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLpxssssssssssssssssp9ogapxssssssssssssssssp8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Nghcitpbi:q:G:cjbahRb:q:W:cjbghpsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Nggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spkbbahaocwffagRb:q:W:cjbfhoxdkaqaopbbbpkbbaoczfhoxekaqaopbbdaoRbbghcitpbi:q:G:cjbahRb:q:W:cjbghpsaoRbeggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPpkbbahaocdffagRb:q:W:cjbfhokalcdfhlaiczfgiaQ6mbkkaohAaoTmoka8EaQfh8Ea5cefg5cl9hmbkdndndndnawTmbaza8Acd4fRbbglciGPlbedwbkaQTmdavcjdfa8Afhlava8Afpbdbh8Jcbhoinalavcj;cbfaofpblbg8KaYaofpblbg8LpmbzeHdOiAlCvXoQrLg8MaLaofpblbg8NaKaofpblbgypmbzeHdOiAlCvXoQrLg8PpmbezHdiOAlvCXorQLg8Fcep9Ta8Fpxeeeeeeeeeeeeeeeegap9op9Hp9rg8Fa8Jp9Ug8Jp9Abbbaladfgla8Ja8Fa8Fpmlvorlvorlvorlvorp9Ug8Jp9Abbbaladfgla8Ja8Fa8FpmwDqkwDqkwDqkwDqkp9Ug8Jp9Abbbaladfgla8Ja8Fa8FpmxmPsxmPsxmPsxmPsp9Ug8Jp9Abbbaladfgla8Ja8Ma8PpmwDKYqk8AExm35Ps8E8Fg8Fcep9Ta8Faap9op9Hp9rg8Fp9Ug8Jp9Abbbaladfgla8Ja8Fa8Fpmlvorlvorlvorlvorp9Ug8Jp9Abbbaladfgla8Ja8Fa8FpmwDqkwDqkwDqkwDqkp9Ug8Jp9Abbbaladfgla8Ja8Fa8FpmxmPsxmPsxmPsxmPsp9Ug8Jp9Abbbaladfgla8Ja8Ka8LpmwKDYq8AkEx3m5P8Es8Fg8Ka8NaypmwKDYq8AkEx3m5P8Es8Fg8LpmbezHdiOAlvCXorQLg8Fcep9Ta8Faap9op9Hp9rg8Fp9Ug8Jp9Abbbaladfgla8Ja8Fa8Fpmlvorlvorlvorlvorp9Ug8Jp9Abbbaladfgla8Ja8Fa8FpmwDqkwDqkwDqkwDqkp9Ug8Jp9Abbbaladfgla8Ja8Fa8FpmxmPsxmPsxmPsxmPsp9Ug8Jp9Abbbaladfgla8Ja8Ka8LpmwDKYqk8AExm35Ps8E8Fg8Fcep9Ta8Faap9op9Hp9rg8Fp9Ugap9Abbbaladfglaaa8Fa8Fpmlvorlvorlvorlvorp9Ugap9Abbbaladfglaaa8Fa8FpmwDqkwDqkwDqkwDqkp9Ugap9Abbbaladfglaaa8Fa8FpmxmPsxmPsxmPsxmPsp9Ug8Jp9AbbbaladfhlaoczfgoaQ6mbxikkaQTmeavcjdfa8Afhlava8Afpbdbh8Jcbhoinalavcj;cbfaofpblbg8KaYaofpblbg8LpmbzeHdOiAlCvXoQrLg8MaLaofpblbg8NaKaofpblbgypmbzeHdOiAlCvXoQrLg8PpmbezHdiOAlvCXorQLg8Fcep:nea8Fpxebebebebebebebebgap9op:bep9rg8Fa8Jp:oeg8Jp9Abbbaladfgla8Ja8Fa8Fpmlvorlvorlvorlvorp:oeg8Jp9Abbbaladfgla8Ja8Fa8FpmwDqkwDqkwDqkwDqkp:oeg8Jp9Abbbaladfgla8Ja8Fa8FpmxmPsxmPsxmPsxmPsp:oeg8Jp9Abbbaladfgla8Ja8Ma8PpmwDKYqk8AExm35Ps8E8Fg8Fcep:nea8Faap9op:bep9rg8Fp:oeg8Jp9Abbbaladfgla8Ja8Fa8Fpmlvorlvorlvorlvorp:oeg8Jp9Abbbaladfgla8Ja8Fa8FpmwDqkwDqkwDqkwDqkp:oeg8Jp9Abbbaladfgla8Ja8Fa8FpmxmPsxmPsxmPsxmPsp:oeg8Jp9Abbbaladfgla8Ja8Ka8LpmwKDYq8AkEx3m5P8Es8Fg8Ka8NaypmwKDYq8AkEx3m5P8Es8Fg8LpmbezHdiOAlvCXorQLg8Fcep:nea8Faap9op:bep9rg8Fp:oeg8Jp9Abbbaladfgla8Ja8Fa8Fpmlvorlvorlvorlvorp:oeg8Jp9Abbbaladfgla8Ja8Fa8FpmwDqkwDqkwDqkwDqkp:oeg8Jp9Abbbaladfgla8Ja8Fa8FpmxmPsxmPsxmPsxmPsp:oeg8Jp9Abbbaladfgla8Ja8Ka8LpmwDKYqk8AExm35Ps8E8Fg8Fcep:nea8Faap9op:bep9rg8Fp:oegap9Abbbaladfglaaa8Fa8Fpmlvorlvorlvorlvorp:oegap9Abbbaladfglaaa8Fa8FpmwDqkwDqkwDqkwDqkp:oegap9Abbbaladfglaaa8Fa8FpmxmPsxmPsxmPsxmPsp:oeg8Jp9AbbbaladfhlaoczfgoaQ6mbxdkkaQTmbcbhocbalcl4gl9Rc8FGhiavcjdfa8Afhrava8Afpbdbhainaravcj;cbfaofpblbg8JaYaofpblbg8KpmbzeHdOiAlCvXoQrLg8LaLaofpblbg8MaKaofpblbg8NpmbzeHdOiAlCvXoQrLgypmbezHdiOAlvCXorQLg8Faip:Rea8Falp:Tep9qg8Faap9rgap9Abbbaradfgraaa8Fa8Fpmlvorlvorlvorlvorp9rgap9Abbbaradfgraaa8Fa8FpmwDqkwDqkwDqkwDqkp9rgap9Abbbaradfgraaa8Fa8FpmxmPsxmPsxmPsxmPsp9rgap9Abbbaradfgraaa8LaypmwDKYqk8AExm35Ps8E8Fg8Faip:Rea8Falp:Tep9qg8Fp9rgap9Abbbaradfgraaa8Fa8Fpmlvorlvorlvorlvorp9rgap9Abbbaradfgraaa8Fa8FpmwDqkwDqkwDqkwDqkp9rgap9Abbbaradfgraaa8Fa8FpmxmPsxmPsxmPsxmPsp9rgap9Abbbaradfgraaa8Ja8KpmwKDYq8AkEx3m5P8Es8Fg8Ja8Ma8NpmwKDYq8AkEx3m5P8Es8Fg8KpmbezHdiOAlvCXorQLg8Faip:Rea8Falp:Tep9qg8Fp9rgap9Abbbaradfgraaa8Fa8Fpmlvorlvorlvorlvorp9rgap9Abbbaradfgraaa8Fa8FpmwDqkwDqkwDqkwDqkp9rgap9Abbbaradfgraaa8Fa8FpmxmPsxmPsxmPsxmPsp9rgap9Abbbaradfgraaa8Ja8KpmwDKYqk8AExm35Ps8E8Fg8Faip:Rea8Falp:Tep9qg8Fp9rgap9Abbbaradfgraaa8Fa8Fpmlvorlvorlvorlvorp9rgap9Abbbaradfgraaa8Fa8FpmwDqkwDqkwDqkwDqkp9rgap9Abbbaradfgraaa8Fa8FpmxmPsxmPsxmPsxmPsp9rgap9AbbbaradfhraoczfgoaQ6mbkka8Aclfg8Aad6mbkdnaCad2goTmbaOavcjdfao;8qbbkdnammbavavcjdfaCcufad2fad;8qbbkaCaHfhHc9:hoaAhPaAmbxlkkaeTmbaDalfhrcbhocuhlinaralaD9RglfaD6mdasaeao9Raoasfae6Eaofgoae6mbkaial9RhPkcbc99axaP9RakSEhoxekc9:hokavcj;kbf8Kjjjjbaokwbz:bjjjbkNsezu8Jjjjjbc;ae9Rgv8Kjjjjbc9:hodnalaeci9UgrcHf6mbcuhoaiRbbgwc;WeGc;Ge9hmbawcsGgDce0mbavc;abfcFecje;8kbav9cu83iUav9cu83i8Wav9cu83iyav9cu83iaav9cu83iKav9cu83izav9cu83iwav9cu83ibaialfc9WfhqaicefgwarfhldnaeTmbcmcsaDceSEhkcbhxcbhmcbhrcbhicbhoindnalaq9nmbc9:hoxikdndnawRbbgDc;Ve0mbavc;abfaoaDcu7gPcl4fcsGcitfgsydlhzasydbhHdndnaDcsGgsak9pmbavaiaPfcsGcdtfydbaxasEhDaxasTgOfhxxekdndnascsSmbcehOasc987asamffcefhDxekalcefhDal8SbbgscFeGhPdndnascu9mmbaDhlxekalcvfhlaPcFbGhPcrhsdninaD8SbbgOcFbGastaPVhPaOcu9kmeaDcefhDascrfgsc8J9hmbxdkkaDcefhlkcehOaPce4cbaPceG9R7amfhDkaDhmkavc;abfaocitfgsaDBdbasazBdlavaicdtfaDBdbavc;abfaocefcsGcitfgsaHBdbasaDBdlaocdfhoaOaifhidnadcd9hmbabarcetfgsaH87ebasclfaD87ebascdfaz87ebxdkabarcdtfgsaHBdbascwfaDBdbasclfazBdbxekdnaDcpe0mbavaiaqaDcsGfRbbgscl4gP9RcsGcdtfydbaxcefgOaPEhDavaias9RcsGcdtfydbaOaPTgzfgOascsGgPEhsaPThPdndnadcd9hmbabarcetfgHax87ebaHclfas87ebaHcdfaD87ebxekabarcdtfgHaxBdbaHcwfasBdbaHclfaDBdbkavaicdtfaxBdbavc;abfaocitfgHaDBdbaHaxBdlavaicefgicsGcdtfaDBdbavc;abfaocefcsGcitfgHasBdbaHaDBdlavaiazfgicsGcdtfasBdbavc;abfaocdfcsGcitfgDaxBdbaDasBdlaocifhoaiaPfhiaOaPfhxxekaxcbalRbbgsEgHaDc;:eSgDfhOascsGhAdndnascl4gCmbaOcefhzxekaOhzavaiaC9RcsGcdtfydbhOkdndnaAmbazcefhxxekazhxavaias9RcsGcdtfydbhzkdndnaDTmbalcefhDxekalcdfhDal8SbegPcFeGhsdnaPcu9kmbalcofhHascFbGhscrhldninaD8SbbgPcFbGaltasVhsaPcu9kmeaDcefhDalcrfglc8J9hmbkaHhDxekaDcefhDkasce4cbasceG9R7amfgmhHkdndnaCcsSmbaDhsxekaDcefhsaD8SbbglcFeGhPdnalcu9kmbaDcvfhOaPcFbGhPcrhldninas8SbbgDcFbGaltaPVhPaDcu9kmeascefhsalcrfglc8J9hmbkaOhsxekascefhskaPce4cbaPceG9R7amfgmhOkdndnaAcsSmbashlxekascefhlas8SbbgDcFeGhPdnaDcu9kmbascvfhzaPcFbGhPcrhDdninal8SbbgscFbGaDtaPVhPascu9kmealcefhlaDcrfgDc8J9hmbkazhlxekalcefhlkaPce4cbaPceG9R7amfgmhzkdndnadcd9hmbabarcetfgDaH87ebaDclfaz87ebaDcdfaO87ebxekabarcdtfgDaHBdbaDcwfazBdbaDclfaOBdbkavc;abfaocitfgDaOBdbaDaHBdlavaicdtfaHBdbavc;abfaocefcsGcitfgDazBdbaDaOBdlavaicefgicsGcdtfaOBdbavc;abfaocdfcsGcitfgDaHBdbaDazBdlavaiaCTaCcsSVfgicsGcdtfazBdbaiaATaAcsSVfhiaocifhokawcefhwaocsGhoaicsGhiarcifgrae6mbkkcbc99alaqSEhokavc;aef8Kjjjjbaok:clevu8Jjjjjbcz9Rhvdnalaecvf9pmbc9:skdnaiRbbc;:eGc;qeSmbcuskav9cb83iwaicefhoaialfc98fhrdnaeTmbdnadcdSmbcbhwindnaoar6mbc9:skaocefhlao8SbbgicFeGhddndnaicu9mmbalhoxekaocvfhoadcFbGhdcrhidninal8SbbgDcFbGaitadVhdaDcu9kmealcefhlaicrfgic8J9hmbxdkkalcefhokabawcdtfadc8Etc8F91adcd47avcwfadceGcdtVglydbfgiBdbalaiBdbawcefgwae9hmbxdkkcbhwindnaoar6mbc9:skaocefhlao8SbbgicFeGhddndnaicu9mmbalhoxekaocvfhoadcFbGhdcrhidninal8SbbgDcFbGaitadVhdaDcu9kmealcefhlaicrfgic8J9hmbxdkkalcefhokabawcetfadc8Etc8F91adcd47avcwfadceGcdtVglydbfgi87ebalaiBdbawcefgwae9hmbkkcbc99aoarSEk;Toio97eue97aec98Ghedndnadcl9hmbaeTmecbhdinababpbbbgicKp:RecKp:Sep;6eglaicwp:RecKp:Sep;6ealp;Geaiczp:RecKp:Sep;6egvp;Gep;Kep;Legopxbbbbbbbbbbbbbbbbp:2egralpxbbbjbbbjbbbjbbbjgwp9op9rp;Keglpxbb;:9cbb;:9cbb;:9cbb;:9calalp;Meaoaop;Meavaravawp9op9rp;Keglalp;Mep;Kep;Kep;Jep;Negvp;Mepxbbn0bbn0bbn0bbn0grp;KepxFbbbFbbbFbbbFbbbp9oaipxbbbFbbbFbbbFbbbFp9op9qalavp;Mearp;Kecwp:RepxbFbbbFbbbFbbbFbbp9op9qaoavp;Mearp;Keczp:RepxbbFbbbFbbbFbbbFbp9op9qpkbbabczfhbadclfgdae6mbxdkkaeTmbcbhdinabczfgDaDpbbbgipxbbbbbbFFbbbbbbFFgwp9oabpbbbgoaipmbediwDqkzHOAKY8AEgvczp:Reczp:Sep;6eglaoaipmlvorxmPsCXQL358E8FpxFubbFubbFubbFubbp9op;6eavczp:Sep;6egvp;Gealp;Gep;Kep;Legipxbbbbbbbbbbbbbbbbp:2egralpxbbbjbbbjbbbjbbbjgqp9op9rp;Keglpxb;:FSb;:FSb;:FSb;:FSalalp;Meaiaip;Meavaravaqp9op9rp;Keglalp;Mep;Kep;Kep;Jep;Negvp;Mepxbbn0bbn0bbn0bbn0grp;KepxFFbbFFbbFFbbFFbbp9oaiavp;Mearp;Keczp:Rep9qgialavp;Mearp;KepxFFbbFFbbFFbbFFbbp9oglpmwDKYqk8AExm35Ps8E8Fp9qpkbbabaoawp9oaialpmbezHdiOAlvCXorQLp9qpkbbabcafhbadclfgdae6mbkkk;2ileue97euo97dnaec98GgiTmbcbheinabcKfpx:ji:1S:ji:1S:ji:1S:ji:1SabpbbbglabczfgvpbbbgopmlvorxmPsCXQL358E8Fgrczp:Segwpxibbbibbbibbbibbbp9qp;6egDp;NegqaDaDp;MegDaDp;KealaopmbediwDqkzHOAKY8AEgDczp:Reczp:Sep;6eglalp;MeaDczp:Sep;6egoaop;Mearczp:Reczp:Sep;6egrarp;Mep;Kep;Kep;Lepxbbbbbbbbbbbbbbbbp:4ep;Jep;Mepxbbn0bbn0bbn0bbn0gDp;KepxFFbbFFbbFFbbFFbbgkp9oaqaop;MeaDp;Keczp:Rep9qgoaqalp;MeaDp;Keakp9oaqarp;MeaDp;Keczp:Rep9qgDpmwDKYqk8AExm35Ps8E8Fglp5eawclp:RegqpEi:T:j83ibavalp5baqpEd:T:j83ibabcwfaoaDpmbezHdiOAlvCXorQLgDp5eaqpEe:T:j83ibabaDp5baqpEb:T:j83ibabcafhbaeclfgeai6mbkkkuee97dnadcd4ae2c98GgeTmbcbhdinababpbbbgicwp:Recwp:Sep;6eaicep:SepxbbjFbbjFbbjFbbjFp9opxbbjZbbjZbbjZbbjZp:Uep;Mepkbbabczfhbadclfgdae6mbkkk:Sodw97euaec98Ghedndnadcl9hmbaeTmecbhdinabpxbbuJbbuJbbuJbbuJabpbbbgicKp:TeglaicYp:Tep9qgvcdp:Teavp9qgvclp:Teavp9qgop;6ep;Negvaicwp:RecKp:SegraipxFbbbFbbbFbbbFbbbgwp9ogDp:Uep;6ep;Mepxbbn0bbn0bbn0bbn0gqp;Kecwp:RepxbFbbbFbbbFbbbFbbp9oavaDarp:Xeaiczp:RecKp:Segip:Uep;6ep;Meaqp;Keawp9op9qavaDaraip:Uep:Xep;6ep;Meaqp;Keczp:RepxbbFbbbFbbbFbbbFbp9op9qavaoalcep:Rep9oalpxebbbebbbebbbebbbp9op9qp;6ep;Meaqp;KecKp:Rep9qpkbbabczfhbadclfgdae6mbxdkkaeTmbcbhdinabczfgkpxbFu9hbFu9hbFu9hbFu9habpbbbglakpbbbgrpmlvorxmPsCXQL358E8Fgvczp:TegqavcHp:Tep9qgicdp:Teaip9qgiclp:Teaip9qgicwp:Teaip9qgop;6ep;NegialarpmbediwDqkzHOAKY8AEgDpxFFbbFFbbFFbbFFbbglp9ograDczp:Segwp:Ueavczp:Reczp:SegDp:Xep;6ep;Mepxbbn0bbn0bbn0bbn0gvp;Kealp9oaiarawaDp:Uep:Xep;6ep;Meavp;Keczp:Rep9qgwaiaoaqcep:Rep9oaqpxebbbebbbebbbebbbp9op9qp;6ep;Meavp;Keczp:ReaiaDarp:Uep;6ep;Meavp;Kealp9op9qgipmwDKYqk8AExm35Ps8E8FpkbbabawaipmbezHdiOAlvCXorQLpkbbabcafhbadclfgdae6mbkkk9teiucbcbydj:G:cjbgeabcifc98GfgbBdj:G:cjbdndnabZbcztgd9nmbcuhiabad9RcFFifcz4nbcuSmekaehikaikkxebcj:Gdklz:zbb",t=new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,3,2,0,0,5,3,1,0,1,12,1,0,10,22,2,12,0,65,0,65,0,65,0,252,10,0,0,11,7,0,65,0,253,15,26,11]),n=new Uint8Array([32,0,65,2,1,106,34,33,3,128,11,4,13,64,6,253,10,7,15,116,127,5,8,12,40,16,19,54,20,9,27,255,113,17,42,67,24,23,146,148,18,14,22,45,70,69,56,114,101,21,25,63,75,136,108,28,118,29,73,115]);if(typeof WebAssembly!="object")return{supported:!1};var s=WebAssembly.validate(t)?o(e):o(i),r,a=WebAssembly.instantiate(s,{}).then(function(p){r=p.instance,r.exports.__wasm_call_ctors()});function o(p){for(var x=new Uint8Array(p.length),w=0;w<p.length;++w){var y=p.charCodeAt(w);x[w]=y>96?y-97:y>64?y-39:y+4}for(var S=0,w=0;w<p.length;++w)x[S++]=x[w]<60?n[x[w]]:(x[w]-60)*64+x[++w];return x.buffer.slice(0,S)}function l(p,x,w,y,S,E,_){var A=p.exports.sbrk,k=y+3&-4,R=A(k*S),D=A(E.length),B=new Uint8Array(p.exports.memory.buffer);B.set(E,D);var W=x(R,y,S,D,E.length);if(W==0&&_&&_(R,k,S),w.set(B.subarray(R,R+y*S)),A(R-A(0)),W!=0)throw new Error("Malformed buffer data: "+W)}var c={NONE:"",OCTAHEDRAL:"meshopt_decodeFilterOct",QUATERNION:"meshopt_decodeFilterQuat",EXPONENTIAL:"meshopt_decodeFilterExp",COLOR:"meshopt_decodeFilterColor"},h={ATTRIBUTES:"meshopt_decodeVertexBuffer",TRIANGLES:"meshopt_decodeIndexBuffer",INDICES:"meshopt_decodeIndexSequence"},u=[],d=0;function f(p){var x={object:new Worker(p),pending:0,requests:{}};return x.object.onmessage=function(w){var y=w.data;x.pending-=y.count,x.requests[y.id][y.action](y.value),delete x.requests[y.id]},x}function m(p){for(var x="self.ready = WebAssembly.instantiate(new Uint8Array(["+new Uint8Array(s)+"]), {}).then(function(result) { result.instance.exports.__wasm_call_ctors(); return result.instance; });self.onmessage = "+g.name+";"+l.toString()+g.toString(),w=new Blob([x],{type:"text/javascript"}),y=URL.createObjectURL(w),S=u.length;S<p;++S)u[S]=f(y);for(var S=p;S<u.length;++S)u[S].object.postMessage({});u.length=p,URL.revokeObjectURL(y)}function b(p,x,w,y,S){for(var E=u[0],_=1;_<u.length;++_)u[_].pending<E.pending&&(E=u[_]);return new Promise(function(A,k){var R=new Uint8Array(w),D=++d;E.pending+=p,E.requests[D]={resolve:A,reject:k},E.object.postMessage({id:D,count:p,size:x,source:R,mode:y,filter:S},[R.buffer])})}function g(p){var x=p.data;self.ready.then(function(w){if(!x.id)return self.close();try{var y=new Uint8Array(x.count*x.size);l(w,w.exports[x.mode],y,x.count,x.size,x.source,w.exports[x.filter]),self.postMessage({id:x.id,count:x.count,action:"resolve",value:y},[y.buffer])}catch(S){self.postMessage({id:x.id,count:x.count,action:"reject",value:S})}})}return{ready:a,supported:!0,useWorkers:function(p){m(p)},decodeVertexBuffer:function(p,x,w,y,S){l(r,r.exports.meshopt_decodeVertexBuffer,p,x,w,y,r.exports[c[S]])},decodeIndexBuffer:function(p,x,w,y){l(r,r.exports.meshopt_decodeIndexBuffer,p,x,w,y)},decodeIndexSequence:function(p,x,w,y){l(r,r.exports.meshopt_decodeIndexSequence,p,x,w,y)},decodeGltfBuffer:function(p,x,w,y,S,E){l(r,r.exports[h[S]],p,x,w,y,r.exports[c[E]])},decodeGltfBufferAsync:function(p,x,w,y,S){return u.length>0?b(p,x,w,h[y],c[S]):a.then(function(){var E=new Uint8Array(p*x);return l(r,r.exports[h[y]],E,p,x,w,r.exports[c[S]]),E})}}})()});function Up(){return Fl||(Fl=Promise.resolve().then(()=>(Fp(),Np)).then(i=>i.MeshoptDecoder),Fl)}var Fl,Op=rt(()=>{"use strict";Fl=null});function pn(i){if(typeof i!="string"||!i)return null;let e=Au(i);if(e)return e;let t=i.replace(/_joint$/i,"");if(t!==i)return Au(t);let n=i.replace(/[._]\d+$/,"");return n!==i?Au(n):null}function Au(i){let e=i;if(e=e.replace(/^(?:[A-Za-z][\w]*:)+/,""),e=e.replace(/^mixamorig\d*[_:]?/i,""),e=e.replace(/^Armature[_/]?/i,""),e=e.replace(/^(DEF|ORG|MCH)[-_]/i,""),e=e.replace(/^CH[_:]/i,""),e=e.replace(/^CC_Base_/i,""),/^spine01$/i.test(e))return"Spine";if(/^spine02$/i.test(e))return"Spine1";e=e.replace(/^j_(?!bip|sec|adj)/i,""),e=e.replace(/^\d+\./,"").replace(/^!/,"").replace(/^joint[_:]/i,""),e=e.replace(/^ValveBiped\.?/i,""),e=e.replace(/^Bip\d+[\s_]?/i,"");let t=e.replace(/[-_.\s]+/g,"").toLowerCase();return hw.get(t)??Eu.get(t)??uw.get(t)??null}function zp(i,e={}){let t=typeof e.isAncestor=="function"?e.isAncestor:null,n=new Map;for(let o of i)n.set(o.canonical,(n.get(o.canonical)||0)+1);let s=(o,l,c)=>o.length<2||!t?o[0]:o.find(u=>l.some(d=>d!==u&&(c?t(u,d):t(d,u))))||o[0],r=(o,l,c)=>{o.canonical=c,n.set(l,(n.get(l)||1)-1),n.set(c,(n.get(c)||0)+1)},a=0;for(let o of["Left","Right"]){let l=`${o}Arm`,c=`${o}Shoulder`;if((n.get(l)||0)<2||(n.get(c)||0)>0)continue;let h=i.filter(m=>m.canonical===l),u=h.filter(m=>Bp.test(m.raw));if(u.length===0)continue;let d=h.filter(m=>dw.test(m.raw)&&!Bp.test(m.raw)),f=s(d,u,!0);f&&(r(f,l,c),a++)}for(let o of["Left","Right"]){let l=`${o}Arm`,c=`${o}Shoulder`;if((n.get(c)||0)<2||(n.get(l)||0)>0)continue;let h=i.filter(m=>m.canonical===c),u=h.filter(m=>Hp.test(m.raw));if(u.length===0)continue;let d=h.filter(m=>/shoulder/i.test(m.raw)&&!Hp.test(m.raw)),f=s(d,u,!1);f&&(r(f,c,l),a++)}return a}var cw,hw,Eu,uw,dw,Bp,Hp,Ul=rt(()=>{"use strict";cw=Object.freeze(["Hips","Spine","Spine1","Spine2","Neck","Head","LeftShoulder","LeftArm","LeftForeArm","LeftHand","LeftHandIndex1","LeftHandIndex2","LeftHandIndex3","LeftHandMiddle1","LeftHandMiddle2","LeftHandMiddle3","LeftHandPinky1","LeftHandPinky2","LeftHandPinky3","LeftHandRing1","LeftHandRing2","LeftHandRing3","LeftHandThumb1","LeftHandThumb2","LeftHandThumb3","RightShoulder","RightArm","RightForeArm","RightHand","RightHandIndex1","RightHandIndex2","RightHandIndex3","RightHandMiddle1","RightHandMiddle2","RightHandMiddle3","RightHandPinky1","RightHandPinky2","RightHandPinky3","RightHandRing1","RightHandRing2","RightHandRing3","RightHandThumb1","RightHandThumb2","RightHandThumb3","LeftUpLeg","LeftLeg","LeftFoot","LeftToeBase","RightUpLeg","RightLeg","RightFoot","RightToeBase"]),hw=(()=>{let i=new Map;for(let e of cw)i.set(e.toLowerCase(),e);return i})(),Eu=new Map(Object.entries({pelvis:"Hips",neck01:"Neck",claviclel:"LeftShoulder",upperarml:"LeftArm",lowerarml:"LeftForeArm",handl:"LeftHand",clavicler:"RightShoulder",upperarmr:"RightArm",lowerarmr:"RightForeArm",handr:"RightHand",thighl:"LeftUpLeg",calfl:"LeftLeg",footl:"LeftFoot",balll:"LeftToeBase",thighr:"RightUpLeg",calfr:"RightLeg",footr:"RightFoot",ballr:"RightToeBase"}));for(let[i,e]of[["thumb","Thumb"],["index","Index"],["middle","Middle"],["ring","Ring"],["pinky","Pinky"]])for(let t=1;t<=3;t++)Eu.set(`${i}0${t}l`,`LeftHand${e}${t}`),Eu.set(`${i}0${t}r`,`RightHand${e}${t}`);uw=(()=>{let i=new Map,e=r=>r.replace(/[-_.\s]+/g,"").toLowerCase(),t=(r,a)=>{let o=e(r);i.has(o)||i.set(o,a)},n=[["J_Bip_C_Hips","Hips"],["J_Bip_C_Spine","Spine"],["J_Bip_C_Chest","Spine1"],["J_Bip_C_UpperChest","Spine2"],["J_Bip_C_Neck","Neck"],["J_Bip_C_Head","Head"],["J_Bip_L_Shoulder","LeftShoulder"],["J_Bip_L_UpperArm","LeftArm"],["J_Bip_L_LowerArm","LeftForeArm"],["J_Bip_L_Hand","LeftHand"],["J_Bip_R_Shoulder","RightShoulder"],["J_Bip_R_UpperArm","RightArm"],["J_Bip_R_LowerArm","RightForeArm"],["J_Bip_R_Hand","RightHand"],["J_Bip_L_UpperLeg","LeftUpLeg"],["J_Bip_L_LowerLeg","LeftLeg"],["J_Bip_L_Foot","LeftFoot"],["J_Bip_L_ToeBase","LeftToeBase"],["J_Bip_L_Toes","LeftToeBase"],["J_Bip_R_UpperLeg","RightUpLeg"],["J_Bip_R_LowerLeg","RightLeg"],["J_Bip_R_Foot","RightFoot"],["J_Bip_R_ToeBase","RightToeBase"],["J_Bip_R_Toes","RightToeBase"]];for(let[r,a]of n)t(r,a);for(let[r,a]of[["Thumb","Thumb"],["Index","Index"],["Middle","Middle"],["Ring","Ring"],["Little","Pinky"]])for(let o=1;o<=3;o++)t(`J_Bip_L_${r}${o}`,`LeftHand${a}${o}`),t(`J_Bip_R_${r}${o}`,`RightHand${a}${o}`);for(let[r,a]of[["\u30BB\u30F3\u30BF\u30FC","Hips"],["\u4E0B\u534A\u8EAB","Hips"],["\u4E0A\u534A\u8EAB","Spine"],["\u4E0A\u534A\u8EAB2","Spine1"],["\u9996","Neck"],["\u982D","Head"]])t(r,a);for(let[r,a]of[["\u5DE6","Left"],["\u53F3","Right"]]){for(let[o,l]of[["\u80A9","Shoulder"],["\u8155","Arm"],["\u3072\u3058","ForeArm"],["\u624B\u9996","Hand"],["\u8DB3","UpLeg"],["\u3072\u3056","Leg"],["\u8DB3\u9996","Foot"],["\u3064\u307E\u5148","ToeBase"]])t(`${r}${o}`,`${a}${l}`);for(let[o,l]of[["\u4EBA\u6307","Index"],["\u4EBA\u5DEE\u6307","Index"],["\u4E2D\u6307","Middle"],["\u85AC\u6307","Ring"],["\u5C0F\u6307","Pinky"]])for(let c=1;c<=3;c++)t(`${r}${o}${c}`,`${a}Hand${l}${c}`);for(let o=0;o<=2;o++)t(`${r}\u89AA\u6307${o}`,`${a}HandThumb${o+1}`)}for(let[r,a]of[["L","Left"],["R","Right"]])["Thumb","Index","Middle","Ring","Pinky"].forEach((o,l)=>{for(let c=1;c<=3;c++)t(`${r} Finger${c===1?l:`${l}${c-1}`}`,`${a}Hand${o}${c}`)}),t(`${r} Toe0`,`${a}ToeBase`);for(let[r,a]of[["Spine4","Spine2"],["Neck1","Neck"],["Head1","Head"]])t(r,a);for(let[r,a]of[["chest","Spine1"],["lowerChest","Spine1"],["chestLower","Spine1"],["upperChest","Spine2"],["chestUpper","Spine2"],["abdomen","Spine"],["abdomenLower","Spine"],["abdomenUpper","Spine1"],["hip","Hips"],["lowerNeck","Neck"],["upperNeck","Neck"],["neckLower","Neck"],["neckUpper","Neck"],["neckTwist01","Neck"],["neckTwist02","Neck"],["torso","Spine"],["waist","Spine"],["upperTorso","Spine1"],["torsoUpper","Spine1"],["lowerTorso","Hips"],["torsoLower","Hips"],["ribcage","Spine1"],["ribs","Spine1"],["mPelvis","Hips"],["mTorso","Spine"],["mChest","Spine1"],["mNeck","Neck"],["mHead","Head"],["SpineBase","Hips"],["SpineMid","Spine"],["SpineShoulder","Spine2"],["root_M","Hips"],["hip_M","Hips"],["pelvis_M","Hips"],["spine1_M","Spine"],["spine2_M","Spine1"],["spine3_M","Spine2"],["chest_M","Spine2"],["neck_M","Neck"],["head_M","Head"],["spine0","Spine"],["hipMaster","Hips"],["lumbar","Spine"],["thoracic","Spine1"],["sternum","Spine2"],["cervical","Neck"],["cranium","Head"],["skull","Head"]])t(r,a);let s=[["leftUpperArm","LeftArm"],["lUpperArm","LeftArm"],["shoulderL","LeftArm"],["lShldr","LeftArm"],["lShldrBend","LeftArm"],["leftLowerArm","LeftForeArm"],["lLowerArm","LeftForeArm"],["elbowL","LeftForeArm"],["lForeArm","LeftForeArm"],["lForearmBend","LeftForeArm"],["forearmL","LeftForeArm"],["upperArmL","LeftArm"],["wristL","LeftHand"],["lHand","LeftHand"],["lCollar","LeftShoulder"],["collarL","LeftShoulder"],["lClavicle","LeftShoulder"],["leftUpperLeg","LeftUpLeg"],["lUpperLeg","LeftUpLeg"],["hipL","LeftUpLeg"],["lThigh","LeftUpLeg"],["lThighBend","LeftUpLeg"],["leftLowerLeg","LeftLeg"],["lLowerLeg","LeftLeg"],["kneeL","LeftLeg"],["shinL","LeftLeg"],["lShin","LeftLeg"],["lCalf","LeftLeg"],["ankleL","LeftFoot"],["lFoot","LeftFoot"],["leftToes","LeftToeBase"],["toeL","LeftToeBase"],["lToe","LeftToeBase"],["lToeBase","LeftToeBase"],["lArm","LeftArm"],["lShoulder","LeftShoulder"],["lLeg","LeftLeg"],["lUpLeg","LeftUpLeg"],["leftHip","LeftUpLeg"],["leftThigh","LeftUpLeg"],["leftKnee","LeftLeg"],["leftShin","LeftLeg"],["leftCalf","LeftLeg"],["leftAnkle","LeftFoot"],["leftElbow","LeftForeArm"],["leftWrist","LeftHand"],["leftCollar","LeftShoulder"],["leftClavicle","LeftShoulder"],["leftToe","LeftToeBase"],["mCollarLeft","LeftShoulder"],["mShoulderLeft","LeftArm"],["mElbowLeft","LeftForeArm"],["mWristLeft","LeftHand"],["mHipLeft","LeftUpLeg"],["mKneeLeft","LeftLeg"],["mAnkleLeft","LeftFoot"],["mFootLeft","LeftToeBase"],["mToeLeft","LeftToeBase"],["ShoulderLeft","LeftArm"],["ElbowLeft","LeftForeArm"],["WristLeft","LeftHand"],["HipLeft","LeftUpLeg"],["KneeLeft","LeftLeg"],["AnkleLeft","LeftFoot"],["FootLeft","LeftToeBase"],["leftHeel","LeftFoot"],["leftFootIndex","LeftToeBase"],["upperLegL","LeftUpLeg"],["lowerLegL","LeftLeg"],["lowerArmL","LeftForeArm"],["scapulaL","LeftShoulder"],["lHip","LeftUpLeg"],["lKnee","LeftLeg"],["lAnkle","LeftFoot"],["lElbow","LeftForeArm"],["lWrist","LeftHand"],["lToes","LeftToeBase"],["humerusL","LeftArm"],["lHumerus","LeftArm"],["ulnaL","LeftForeArm"],["lUlna","LeftForeArm"],["radiusL","LeftForeArm"],["lRadius","LeftForeArm"],["carpusL","LeftHand"],["lCarpus","LeftHand"],["femurL","LeftUpLeg"],["lFemur","LeftUpLeg"],["tibiaL","LeftLeg"],["lTibia","LeftLeg"],["fibulaL","LeftLeg"],["lFibula","LeftLeg"],["talusL","LeftFoot"],["lTalus","LeftFoot"],["tarsusL","LeftFoot"],["lTarsus","LeftFoot"],["calcaneusL","LeftFoot"],["lCalcaneus","LeftFoot"],["metatarsusL","LeftToeBase"],["lMetatarsus","LeftToeBase"]];for(let[r,a]of[["Thumb","Thumb"],["Index","Index"],["Middle","Middle"],["Ring","Ring"],["Pinky","Pinky"],["Little","Pinky"]]){let o=r.toLowerCase();for(let c=1;c<=3;c++){s.push([`l${r}${c}`,`LeftHand${a}${c}`]),s.push([`f_${o}.0${c}.L`,`LeftHand${a}${c}`]),s.push([`${o}.0${c}.L`,`LeftHand${a}${c}`]);let h=["Thumb","Index","Middle","Ring","Pinky"].indexOf(a)+1;h>0&&s.push([`finger${h}-${c}.L`,`LeftHand${a}${c}`])}(a==="Thumb"?["Metacarpal","Proximal","Distal"]:["Proximal","Intermediate","Distal"]).forEach((c,h)=>{s.push([`left${r}${c}`,`LeftHand${a}${h+1}`]),s.push([`${o}_${c.toLowerCase()}.L`,`LeftHand${a}${h+1}`])})}for(let r=1;r<=3;r++)s.push([`lMid${r}`,`LeftHandMiddle${r}`]);for(let[r,a]of[["Thumb","Thumb"],["Index","Index"],["Middle","Middle"],["Ring","Ring"],["Pinky","Pinky"],["Little","Pinky"]]){for(let o=1;o<=3;o++)s.push([`${r}${o}L`,`LeftHand${a}${o}`]),s.push([`${r}Finger${o}L`,`LeftHand${a}${o}`]);s.push([`${r}L`,`LeftHand${a}1`]),s.push([`${r}FingerL`,`LeftHand${a}1`])}for(let[r,a]of s){t(r,a);let o=a.replace(/^Left/,"Right"),l;/^left/.test(r)?l=r.replace(/^left/,"right"):/^l[A-Z]/.test(r)?l="r"+r.slice(1):/Left$/.test(r)?l=r.replace(/Left$/,"Right"):/L$/.test(r)?l=r.replace(/L$/,"R"):l=r,t(l,o)}return i})();dw=/shoulder|clavicle|collar|scapula/i,Bp=/upper.?arm|humerus/i,Hp=/clavicle|collar|scapula/i});var Tu,Gp,Ru,ya,Vp=rt(()=>{"use strict";Tu=Object.freeze({Head:[-.11706881878098431,9438845082943482e-24,372654613409334e-22,.993123804804428],Hips:[.0010741148761599644,6537898515070053e-23,7022659074474357e-26,.9999994231384476],LeftArm:[-.003089573263103852,.08018148459223169,-.025041829737156785,.9964608827384491],LeftFoot:[.5523737034239063,.0002518875693487157,.0036538113016644914,.8335885543726441],LeftForeArm:[-26826767953574183e-23,12816740072681333e-23,.012369379808617674,.9999234962951223],LeftHand:[-.0012910117424963744,.002537815819541244,.010116448936771993,.9999447735952517],LeftHandIndex1:[.028803290204768833,.011362422123976328,.055965724298468224,.9979524555518633],LeftHandIndex2:[-.005195237841915152,.014315447122751807,.00021581682553071412,.9998840087229335],LeftHandIndex3:[-.0013151015878908295,-.016941197343945148,-.006458334440614796,.9998347644768737],LeftHandMiddle1:[.027532617383276645,-.031607746403852485,.016931179482824785,.9989775976007271],LeftHandMiddle2:[-.001267981765488788,.0010468621884392817,-.004466175725402764,.9999886747239598],LeftHandMiddle3:[-.0015803533040544947,.0018352886876119797,.0038040706030556736,.9999898315711762],LeftHandPinky1:[.009345046842530319,-.07377447953394943,-.04207784173776388,.9963430390695086],LeftHandPinky2:[-.0019002180814112143,.0002770864318134059,.0004968185265866393,.9999980327809131],LeftHandPinky3:[-.0014157518824255099,-.005595319155644295,-.004606740515194791,.9999727326242506],LeftHandRing1:[.018207541076892743,-.03436008716699126,-.036855349348364555,.9985637451229231],LeftHandRing2:[-.0006571286469542868,.015477225242721515,.01003471962236163,.9998296495318929],LeftHandRing3:[.001815607007583071,-.003099595768579846,.0072046170631637615,.999967594260012],LeftHandThumb1:[.1900227602341495,-.058826116539083484,.3478783626049766,.9161940209594684],LeftHandThumb2:[.01801363066187901,-.020968588375318502,-.22063576333056306,.9749644544258214],LeftHandThumb3:[-.014498565873099356,.03466160908487025,.011599642488048602,.9992266072970502],LeftLeg:[-.022987686472704008,-.0006608912898930547,7960712093047862e-20,.9997355266049326],LeftShoulder:[.5181706903502131,.5134387363832796,-.48299308003518876,.4843526489955184],LeftToeBase:[.23652217735689587,.0006644108661216591,-.002051152932444189,.9716236982227819],LeftUpLeg:[-4952055077835167e-20,.0032567616062252223,.9999946186652781,-.00039203576089550014],Neck:[.2225107795455935,-23352293238692193e-23,-19647139012020554e-24,.974930229804142],RightArm:[-.003089570938390283,-.08018164882954634,.025041835809991725,.9964608693782484],RightFoot:[.5523737112340288,-.00025188760500252676,-.0036538107149212758,.8335885491999105],RightForeArm:[-2706717415294191e-22,60675494372234465e-25,-.012369382961452784,.9999234962561284],RightHand:[-.0012910114923260908,-.002537815924782367,-.010116450486313036,.9999447735796301],RightHandIndex1:[.028803284769926347,-.01136242475457741,-.05596571258489258,.9979524563349205],RightHandIndex2:[-.005195229421057241,-.014315442233259087,-.00021582506177354608,.9998840088349297],RightHandIndex3:[-.0013151045827228072,.016941319655899355,.006458327385746035,.9998347624459482],RightHandMiddle1:[.027532662650122483,.03160778647114273,-.01693120529165708,.9989775946478099],RightHandMiddle2:[-.0012680273836480952,-.0010469047250576836,.004466199390698661,.9999886745158897],RightHandMiddle3:[-.0015803562094451136,-.001835288773706009,-.003804068167924464,.9999898315756854],RightHandPinky1:[.009345030274151258,.07377446325595405,.04207784564870347,.9963430402658229],RightHandPinky2:[-.0019002008217559384,-.0002769620503994165,-.0004968229018870381,.9999980328459891],RightHandPinky3:[-.0014157497333212687,.0055951881780210025,.004606743315319843,.9999727333471813],RightHandRing1:[.01820754441109714,.03436008722907556,.03685535429214536,.9985637448787448],RightHandRing2:[-.0006571335802527884,-.015477230302375519,-.010034723368684675,.999829649412505],RightHandRing3:[.0018156069598940002,.003099598646436032,-.007204626788931167,.9999675941811231],RightHandThumb1:[.19002276085311107,.05882618704962336,-.3478783387552461,.9161940229953188],RightHandThumb2:[.018013663274561078,.020968550782212388,.22063584956274163,.9749644350943654],RightHandThumb3:[-.014498582331377526,-.03466161961137741,-.011599713293476643,.9992266058762234],RightLeg:[-.022987685898989207,.0006609402907891899,-7960698692017099e-20,.9997355265857409],RightShoulder:[.5181706006117709,-.5134387953473804,.4829931766210871,.4843525890882128],RightToeBase:[.23652222014073046,-.0006644109035597298,.0020511526077556528,.9716236878087238],RightUpLeg:[49438593286575395e-21,.003256759408127677,.9999946186765544,.0003920356017771739],Spine:[-.018332562694809717,-14544833124647894e-23,26976261645093277e-26,.9998319444511763],Spine1:[-.03815628571181615,20010687323521798e-24,534807122500512e-23,.9992717837809081],Spine2:[-.056998031890724846,13546308636882866e-23,-8861325315468363e-25,.9983742907149431]}),Gp=Object.freeze({Head:[-.005402766806732544,-15440620455356296e-23,834223242528311e-24,.9999854049488961],Hips:[.0010741148761599644,6537898515070053e-23,7022659074474357e-26,.9999994231384476],LeftArm:[.4889318420664182,.5108287295941205,-.5108290884863605,.48893078190839623],LeftFoot:[-7112359875637768e-20,.5349085331963127,.8448985998862468,-.004383145577274271],LeftForeArm:[.49521300584988104,.5047420653526237,-.5047420379230214,.4952120815979495],LeftHand:[.5009334720626235,.5016127781291206,-.4977959877649929,.49964931327533474],LeftHandIndex1:[.5480286232738694,.46388966319384123,-.47756977349452234,.506357703809076],LeftHandIndex2:[.5522711480640051,.4734474077351049,-.46714980714345783,.5026083894226862],LeftHandIndex3:[.5405471533897316,.46903549072233974,-.4790521335412708,.5082553896043159],LeftHandMiddle1:[.5069366564823887,.46312011824587895,-.5184714785961669,.5096295836965867],LeftHandMiddle2:[.5047591066222094,.46656986579426646,-.5196237813564338,.5074661907650336],LeftHandMiddle3:[.5066805225023663,.46639751835165716,-.5160243364733309,.509379123507728],LeftHandPinky1:[.4459394011607033,.4793433042957962,-.5586434331057456,.5092009093395086],LeftHandPinky2:[.4453638702749085,.48032344738196137,-.5573549331147079,.5101920146245817],LeftHandPinky3:[.4392981168466072,.4802964151504903,-.5615019919023976,.5109286011992389],LeftHandRing1:[.47371996160924823,.4931227775910745,-.5418410288696247,.4886999364902444],LeftHandRing2:[.48665266892609377,.49620490515614146,-.5291888435031511,.48673303168821197],LeftHandRing3:[.48945530931580683,.4902132045285772,-.5280743092981476,.4911843263440915],LeftHandThumb1:[.6991138207882592,.16132571576360077,-.40704633814367386,.5652673372230799],LeftHandThumb2:[.64766423234777,.2923511094450446,-.5391393932239583,.4520957758831027],LeftHandThumb3:[.6626872004096495,.3080994487427915,-.5067905211225114,.45725679518685386],LeftLeg:[.0006202111480182034,-.020805293540463354,.9997832430476497,-.00047118992773536965],LeftShoulder:[.4605450937998788,.4559956590278878,-.537559006794696,.5394409087622226],LeftToeBase:[-.002764355526654178,.7195640056310856,.6944147145329627,-.0028643286082629046],LeftUpLeg:[-4987623525000119e-20,.0021826506059020026,.9999975399461294,-.00039198262713485737],Neck:[.11170149382802401,-1628868597421303e-22,-18309282630496044e-24,.9937418056399563],RightArm:[.48893190585215524,-.510828798312402,.5108290283825504,.48893071200502375],RightFoot:[7112360405196955e-20,.5349085398019146,.844898595705669,.004383145306035045],RightForeArm:[.4952130023257164,-.5047420673116668,.5047420415306929,.49521208229448166],RightHand:[.5009334695181179,-.5016127792807403,.49779599067075153,.49964931459617906],RightHandIndex1:[.5480286139806538,-.4638896746971551,.47756977858103167,.5063577013132781],RightHandIndex2:[.5522711446711094,-.4734474082706649,.4671498147721218,.5026083883587248],RightHandIndex3:[.5405470934413514,-.4690354263302402,.47905220274050364,.5082554503330304],RightHandMiddle1:[.5069366680435416,-.4631200623546733,.5184715098400317,.5096295939664325],RightHandMiddle2:[.5047591061928465,-.46656986723577604,.5196237819671778,.5074661920185282],RightHandMiddle3:[.5066805195140975,-.4663975225827095,.5160243369168757,.5093791249234989],RightHandPinky1:[.44593939683725603,-.4793433241517071,.5586434219640141,.5092009094272859],RightHandPinky2:[.4453638073881448,-.4803233923217868,.5573549834847424,.5101920690951159],RightHandPinky3:[.4392981269307416,-.4802964267888911,.5615019867791732,.5109285899785551],RightHandRing1:[.473719957983008,-.49312277921221886,.541841035805614,.4886999335659278],RightHandRing2:[.48665266754747677,-.4962049100848307,.5291888437972645,.4867330306200585],RightHandRing3:[.4894553112113337,-.49021320332208906,.5280743062058759,.4911843318554558],RightHandThumb1:[.6991137732035737,-.16132569450370315,.40704638897707807,.5652673641991798],RightHandThumb2:[.6476641963757893,-.2923511418798965,.5391394672107036,.45209571648691005],RightHandThumb3:[.6626871862817486,-.3080994479425299,.5067905521115058,.4572567801626834],RightLeg:[-.0006202113471683521,-.020805295090456907,.9997832430151556,.00047119017271936915],RightShoulder:[.46054507521936333,-.45599564278848104,.5375590232993736,.5394409245169026],RightToeBase:[.0027643555231566678,.7195640416379069,.6944146772223956,.0028643286020973192],RightUpLeg:[49925034443819034e-21,.002182648459062353,.9999975399486299,.00039198198974856475],Spine:[-.017258617754264162,-800818266828763e-22,13823133775055108e-25,.9998510589648868],Spine1:[-.055396652424023016,-5997624651397324e-23,332759956947242e-23,.9984644264570511],Spine2:[-.11221710079276989,7513757486198981e-23,-8485311473269302e-24,.9936837134066652]}),Ru=Object.freeze({Head:[0,1.644459,-.02811],Hips:[0,.984089,.005022],LeftArm:[.204124,1.50826,-.034115],LeftFoot:[.095793,.088025,-.010018],LeftForeArm:[.458234,1.508259,-.045252],LeftHand:[.725837,1.508259,-.050352],LeftHandIndex1:[.815413,1.499602,-.024435],LeftHandIndex2:[.847794,1.497747,-.020782],LeftHandIndex3:[.872293,1.496601,-.017998],LeftHandMiddle1:[.820067,1.500491,-.048839],LeftHandMiddle2:[.854745,1.498698,-.047572],LeftHandMiddle3:[.881683,1.49736,-.046832],LeftHandPinky1:[.810112,1.495569,-.08743],LeftHandPinky2:[.8359,1.495002,-.089537],LeftHandPinky3:[.856018,1.494638,-.091171],LeftHandRing1:[.81666,1.499944,-.069059],LeftHandRing2:[.850313,1.498728,-.071468],LeftHandRing3:[.87354,1.497943,-.072665],LeftHandThumb1:[.761831,1.487283,-.024616],LeftHandThumb2:[.783931,1.477329,-.003377],LeftHandThumb3:[.806009,1.466616,.003515],LeftLeg:[.09541,.505427,.007362],LeftShoulder:[.056656,1.508576,-.035092],LeftToeBase:[.096919,.022281,.128921],LeftUpLeg:[.095072,.936186,.005482],Neck:[0,1.516499,-.057245],RightArm:[-.204124,1.50826,-.034115],RightFoot:[-.095793,.088025,-.010018],RightForeArm:[-.458234,1.508259,-.045252],RightHand:[-.725837,1.508259,-.050352],RightHandIndex1:[-.815413,1.499602,-.024435],RightHandIndex2:[-.847794,1.497747,-.020783],RightHandIndex3:[-.872293,1.496601,-.017998],RightHandMiddle1:[-.820067,1.500491,-.048839],RightHandMiddle2:[-.854745,1.498698,-.047572],RightHandMiddle3:[-.881683,1.49736,-.046832],RightHandPinky1:[-.810112,1.495569,-.08743],RightHandPinky2:[-.8359,1.495002,-.089537],RightHandPinky3:[-.856018,1.494638,-.091171],RightHandRing1:[-.81666,1.499944,-.069059],RightHandRing2:[-.850313,1.498729,-.071468],RightHandRing3:[-.87354,1.497943,-.072665],RightHandThumb1:[-.761831,1.487283,-.024615],RightHandThumb2:[-.783931,1.477329,-.003377],RightHandThumb3:[-.806009,1.466616,.003515],RightLeg:[-.09541,.505427,.007362],RightShoulder:[-.056656,1.508576,-.035092],RightToeBase:[-.096919,.022281,.128921],RightUpLeg:[-.095072,.936186,.005482],Spine:[0,1.077013,.005222],Spine1:[0,1.184494,.00151],Spine2:[0,1.330917,-.014788]}),ya=Object.freeze({Head:"Neck",Hips:null,LeftArm:"LeftShoulder",LeftFoot:"LeftLeg",LeftForeArm:"LeftArm",LeftHand:"LeftForeArm",LeftHandIndex1:"LeftHand",LeftHandIndex2:"LeftHandIndex1",LeftHandIndex3:"LeftHandIndex2",LeftHandMiddle1:"LeftHand",LeftHandMiddle2:"LeftHandMiddle1",LeftHandMiddle3:"LeftHandMiddle2",LeftHandPinky1:"LeftHand",LeftHandPinky2:"LeftHandPinky1",LeftHandPinky3:"LeftHandPinky2",LeftHandRing1:"LeftHand",LeftHandRing2:"LeftHandRing1",LeftHandRing3:"LeftHandRing2",LeftHandThumb1:"LeftHand",LeftHandThumb2:"LeftHandThumb1",LeftHandThumb3:"LeftHandThumb2",LeftLeg:"LeftUpLeg",LeftShoulder:"Spine2",LeftToeBase:"LeftFoot",LeftUpLeg:"Hips",Neck:"Spine2",RightArm:"RightShoulder",RightFoot:"RightLeg",RightForeArm:"RightArm",RightHand:"RightForeArm",RightHandIndex1:"RightHand",RightHandIndex2:"RightHandIndex1",RightHandIndex3:"RightHandIndex2",RightHandMiddle1:"RightHand",RightHandMiddle2:"RightHandMiddle1",RightHandMiddle3:"RightHandMiddle2",RightHandPinky1:"RightHand",RightHandPinky2:"RightHandPinky1",RightHandPinky3:"RightHandPinky2",RightHandRing1:"RightHand",RightHandRing2:"RightHandRing1",RightHandRing3:"RightHandRing2",RightHandThumb1:"RightHand",RightHandThumb2:"RightHandThumb1",RightHandThumb3:"RightHandThumb2",RightLeg:"RightUpLeg",RightShoulder:"Spine2",RightToeBase:"RightFoot",RightUpLeg:"Hips",Spine:"Hips",Spine1:"Spine",Spine2:"Spine1"})});function xw(i,e){for(let t=e?.parent;t;t=t.parent)if(t===i)return!0;return!1}function zl(i){let e=[],t=new Set,n=a=>{if(!a?.name||t.has(a))return;t.add(a);let o=pn(a.name);o&&e.push({node:a,raw:a.name,canonical:o})},s=[];i.traverse(a=>{a.isSkinnedMesh&&s.push(a),a.isBone&&n(a)});for(let a of s)for(let o of a.skeleton?.bones||[])n(o);zp(e,{isAncestor:(a,o)=>xw(a.node,o.node)});let r=new Set;return e.filter(a=>r.has(a.canonical)?!1:(r.add(a.canonical),!0))}function jp(i){let e=new Map;for(let{canonical:t,node:n}of zl(i))e.set(t,n.name);return e}function yw(i){let e=new Map;if(!i?.traverse)return e;for(let{canonical:t,node:n}of zl(i))e.set(t,n);return e}function Yp(i){let e=new Map;for(let{canonical:t,node:n}of zl(i))e.set(t,n.quaternion.clone());return e}function vw(i,e){let t=i.quaternion.clone();for(let n=i.parent;n&&n!==e;n=n.parent)t.premultiply(n.quaternion);return t}function Kp(i){let e=new Map;for(let{canonical:t,node:n}of zl(i))e.set(t,vw(n,i));return e}function ww(i,e){let t=new Map;for(let[n,s]of Object.entries(qp)){let r=i.get(n),a=i.get(s);if(!r||!a)continue;let o=e(a).sub(e(r));o.lengthSq()>1e-12&&t.set(n,o.normalize())}return t}function Jp(i){if(!i?.traverse)return new Map;i.updateMatrixWorld(!0);let e=yw(i);return ww(e,t=>i.worldToLocal(t.getWorldPosition(new L)))}function Mw(i){let e=new Map;if(!(i instanceof Map)||i.size===0)return e;let t=new Map,n=new L;for(let s of bw){let r=t.get(ya[s])||null;if(gw.has(s))continue;let a=i.get(s),o=Xp.get(s);if(!a||!o){r&&t.set(s,r);continue}n.copy(a),r&&n.applyQuaternion(r);let l=n.dot(o)>_w?null:new _e().setFromUnitVectors(n,o);l&&r?t.set(s,l.multiply(r)):(l||r)&&t.set(s,l||r)}for(let[s,r]of t)1-Math.abs(r.w)>=Hl&&e.set(s,r);return e}function $p(i){let e=new Map;return i.traverse(t=>{if(!(!t?.morphTargetDictionary||!t.name))for(let n of Object.keys(t.morphTargetDictionary)){e.has(n)||e.set(n,[]);let s=e.get(n);s.includes(t.name)||s.push(t.name)}}),e}function Sw(i,e,t){let n=new Map;if(!(i instanceof Map))return n;let s=e instanceof Map,r=s?Mw(t):new Map;for(let[a,o]of pw){let l=i.get(a);if(!l)continue;let c=mw.get(a),h=s?e.get(a):null,u,d=null;if(c&&h){let m=r.get(a),b=r.get(ya[a]);u=l.clone().multiply(h.clone().invert()),b&&u.multiply(b.clone().invert()),u.multiply(c).multiply(o.clone().invert()),d=c.clone().invert(),m&&d.multiply(m),d.multiply(h),1-Math.abs(d.w)<Hl&&(d=null)}else u=l.clone().multiply(o.clone().invert());let f=1-Math.abs(u.w)<Hl;f&&!d||n.set(a,{L:f?null:u,R:d})}return n}function Aw(i,{L:e,R:t}){for(let n=0;n<i.length;n+=4)bs.set(i[n],i[n+1],i[n+2],i[n+3]),e&&bs.premultiply(e),t&&bs.multiply(t),i[n]=bs.x,i[n+1]=bs.y,i[n+2]=bs.z,i[n+3]=bs.w}function Ew(i,e){for(let t=0;t<i.length;t+=3)Ol.set(i[t],i[t+1],i[t+2]).applyQuaternion(e),i[t]=Ol.x,i[t+1]=Ol.y,i[t+2]=Ol.z}function Tw(i,e){if(i){let t=i.isQuaternion?i.clone():new _e(i[0],i[1],i[2],i[3]);return t.invert(),1-Math.abs(t.w)<Hl?null:t}return e.get("Hips")?.L||null}function Zp(i){let e=null;if(i.traverse(n=>{!e&&n.isBone&&n.name&&pn(n.name)==="Hips"&&(e=n)}),e||i.traverse(n=>{!e&&n.name&&pn(n.name)==="Hips"&&(e=n)}),!e||!e.parent)return null;let t=new _e;for(let n=e.parent;n&&n!==i;n=n.parent)t.premultiply(n.quaternion);return t}function Qp(i){try{return new bt().setFromObject(i).min.y}catch{return NaN}}function Cu(i){let e=null;if(i.traverse(r=>{!e&&r.isBone&&r.name&&pn(r.name)==="Hips"&&(e=r)}),e||i.traverse(r=>{!e&&r.name&&pn(r.name)==="Hips"&&(e=r)}),!e||!e.parent)return 0;e.updateWorldMatrix(!0,!1),e.getWorldPosition(mr);let t=mr.y,n=Qp(i);Number.isFinite(n)&&(t-=n),e.parent.matrixWorld.decompose(mr,Rw,Bl);let s=(Bl.x+Bl.y+Bl.z)/3;return!(s>1e-6)||!(t>0)||!Number.isFinite(t)?0:t/s}function Lu(i){let e=null;if(i.traverse(s=>{!e&&s.isBone&&s.name&&pn(s.name)==="Hips"&&(e=s)}),e||i.traverse(s=>{!e&&s.name&&pn(s.name)==="Hips"&&(e=s)}),!e||!e.parent)return 0;e.updateWorldMatrix(!0,!1);let t=Qp(i);if(!Number.isFinite(t))return 0;e.getWorldPosition(mr);let n=e.parent.worldToLocal(new L(mr.x,t,mr.z));return Number.isFinite(n.y)?n.y:0}function em(i){let e=i.tracks.find(t=>t.name.endsWith(".position")&&pn(t.name.split(".")[0])==="Hips");return!e||e.values.length<3?0:e.values[1]}function tm(i,e,t={}){let n=Number.isFinite(t.hipScale)&&t.hipScale>0?t.hipScale:1,s=Number.isFinite(t.hipOffsetY)?t.hipOffsetY:0,r=t.minCoverage??fw,a=Sw(t.targetRest,t.targetWorldRest,t.targetRestDirections),o=Tw(t.hipsParentWorldQuat,a),l=[],c=[],h=[],u=0;for(let b of i.tracks){let g=b.name.indexOf(".");if(g===-1)continue;let p=b.name.slice(0,g),x=b.name.slice(g+1);if(x.startsWith(Wp)){let _=x.slice(Wp.length,-1),A=t.morphTargets instanceof Map?t.morphTargets.get(_):null;if(!A?.length){l.push(_);continue}for(let k of A){let R=b.clone();R.name=`${k}.${x}`,h.push(R)}continue}let w=pn(p)||p;if(!(x==="quaternion"||x==="position"&&w==="Hips"))continue;u++;let S=e.get(w);if(!S){l.push(w);continue}let E=b.clone();if(E.name=`${S}.${x}`,x==="quaternion"){let _=a.get(w);_&&Aw(E.values,_)}else{if(o&&Ew(E.values,o),n!==1)for(let _=0;_<E.values.length;_++)E.values[_]*=n;if(s!==0)for(let _=1;_<E.values.length;_+=3)E.values[_]+=s}c.push(E)}let d=c.length,f=u>0?d/u:0;if(f<r)return{clip:null,matched:d,total:u,coverage:f,dropped:l,hipScale:n,face:0};let m=i.clone();return m.tracks=[...c,...h],{clip:m,matched:d,total:u,coverage:f,dropped:l,hipScale:n,face:h.length}}var fw,pw,mw,Hl,qp,gw,_w,Xp,bw,Wp,Ol,bs,mr,Rw,Bl,nm=rt(()=>{"use strict";at();Ul();Vp();fw=.5,pw=new Map(Object.entries(Tu).map(([i,e])=>[i,new _e(e[0],e[1],e[2],e[3])])),mw=new Map(Object.entries(Gp).map(([i,e])=>[i,new _e(e[0],e[1],e[2],e[3])])),Hl=1e-6,qp=Object.freeze({LeftArm:"LeftForeArm",LeftForeArm:"LeftHand",RightArm:"RightForeArm",RightForeArm:"RightHand",LeftUpLeg:"LeftLeg",LeftLeg:"LeftFoot",RightUpLeg:"RightLeg",RightLeg:"RightFoot"}),gw=new Set(["LeftFoot","RightFoot"]),_w=1-1e-6,Xp=new Map;for(let[i,e]of Object.entries(qp)){let t=Ru[i],n=Ru[e];if(!t||!n)continue;let s=new L(n[0]-t[0],n[1]-t[1],n[2]-t[2]);s.lengthSq()>1e-12&&Xp.set(i,s.normalize())}bw=(()=>{let i=e=>{let t=0;for(let n=ya[e];n;n=ya[n])t++;return t};return Object.keys(Tu).sort((e,t)=>i(e)-i(t))})(),Wp="morphTargetInfluences[",Ol=new L,bs=new _e;mr=new L,Rw=new _e,Bl=new L});function Iw(i){for(let e of i.children)if(e.isBone)return e;return null}function lm(i,e){if(!i||e&&(e.has("LeftArm")||e.has("RightArm")))return 0;i.updateMatrixWorld(!0);let t=[],n=1/0,s=-1/0;if(i.traverse(c=>{if(!c.isBone)return;let h=Iw(c);if(!h)return;c.getWorldPosition(Pu),h.getWorldPosition(im);let u=im.clone().sub(Pu),d=u.length();if(d<1e-5)return;u.multiplyScalar(1/d);let f=Pu.y;f<n&&(n=f),f>s&&(s=f),t.push({bone:c,worldY:f,dir:u})}),t.length===0||!Number.isFinite(n)||s<=n)return 0;let r=(n+s)/2,a=null,o=null;for(let c of t){let{dir:h,worldY:u}=c;u<r||Math.abs(h.y)>Lw||h.y<Pw||Math.abs(h.x)<Cw||(h.x>0?(!a||h.x>a.dir.x)&&(a=c):(!o||h.x<o.dir.x)&&(o=c))}let l=0;for(let c of[a,o])c&&kw(c.bone,c.dir)&&l++;return l}function kw(i,e){let t=e.x>=0?1:-1;rm.set(t*.14,-1,.1).normalize(),sm.copy(e),am.setFromUnitVectors(sm,rm),i.getWorldQuaternion(om),i.parent?i.parent.getWorldQuaternion(Iu):Iu.identity();let n=am.multiply(om),s=Iu.invert().multiply(n);return i.quaternion.copy(s),i.updateMatrixWorld(!0),!0}var Cw,Lw,Pw,Pu,im,sm,rm,am,om,Iu,cm=rt(()=>{"use strict";at();Cw=.6,Lw=.38,Pw=-.4,Pu=new L,im=new L,sm=new L,rm=new L,am=new _e,om=new _e,Iu=new _e});function Dw(){if(typeof window>"u")return!1;try{let i=new URLSearchParams(window.location.search);if(i.has("debug")&&i.get("debug")!=="0"||window.localStorage?.getItem("tws:debug")==="1")return!0}catch{}return!1}var Nw,Gl,wa,va,mn,hm=rt(()=>{"use strict";Nw=!1,Gl=Nw||Dw(),wa=()=>{},va=i=>typeof console<"u"&&typeof console[i]=="function"?console[i].bind(console):wa,mn={error:va("error"),warn:Gl?va("warn"):wa,info:Gl?va("info"):wa,debug:Gl?va("debug"):wa,log:Gl?va("log"):wa}});var Hm={};La(Hm,{VRMAnimation:()=>Bm,VRMAnimationLoaderPlugin:()=>rM,VRMLookAtQuaternionProxy:()=>Ou,createVRMAnimationClip:()=>eM,createVRMAnimationExpressionTracks:()=>Um,createVRMAnimationHumanoidTracks:()=>Fm,createVRMAnimationLookAtTrack:()=>Om});function Fw(i,e,t){var n,s;let r=i.parser.json,a=(n=r.nodes)==null?void 0:n[e];if(a==null)return console.warn(`extractPrimitivesInternal: Attempt to use nodes[${e}] of glTF but the node doesn't exist`),null;let o=a.mesh;if(o==null)return null;let l=(s=r.meshes)==null?void 0:s[o];if(l==null)return console.warn(`extractPrimitivesInternal: Attempt to use meshes[${o}] of glTF but the mesh doesn't exist`),null;let c=l.primitives.length,h=[];return t.traverse(u=>{h.length<c&&u.isMesh&&h.push(u)}),h}function fm(i,e){return Cn(this,null,function*(){let t=yield i.parser.getDependency("node",e);return Fw(i,e,t)})}function Uw(i){return Math.max(Math.min(i,1),0)}function Gw(i){return i.invert?i.invert():i.inverse(),i}function Uu(i,e){return i.matrixWorld.decompose(Vw,e,Ww),e}function Vl(i){return[Math.atan2(-i.z,i.x),Math.atan2(i.y,Math.sqrt(i.x*i.x+i.z*i.z))]}function vm(i){let e=Math.round(i/2/Math.PI);return i-2*Math.PI*e}function Fm(i,e,t){var n,s;let r=new Map,a=new Map;for(let[o,l]of i.humanoidTracks.rotation.entries()){let c=(n=e.getNormalizedBoneNode(o))==null?void 0:n.name;if(c!=null){let h=new On(`${c}.quaternion`,l.times,l.values.map((u,d)=>t==="0"&&d%2===0?-u:u));a.set(o,h)}}for(let[o,l]of i.humanoidTracks.translation.entries()){let c=(s=e.getNormalizedBoneNode(o))==null?void 0:s.name;if(c!=null){let h=i.restHipsPosition.y,d=e.normalizedRestPose.hips.position[1]/h,f=l.clone();f.values=f.values.map((m,b)=>(t==="0"&&b%3!==1?-m:m)*d),f.name=`${c}.position`,r.set(o,f)}}return{translation:r,rotation:a}}function Um(i,e){let t=new Map,n=new Map;for(let[s,r]of i.expressionTracks.preset.entries()){let a=e.getExpressionTrackName(s);if(a!=null){let o=r.clone();o.name=a,t.set(s,o)}}for(let[s,r]of i.expressionTracks.custom.entries()){let a=e.getExpressionTrackName(s);if(a!=null){let o=r.clone();o.name=a,n.set(s,o)}}return{preset:t,custom:n}}function Om(i,e){if(i.lookAtTrack==null)return null;let t=i.lookAtTrack.clone();return t.name=e,t}function eM(i,e){let t=[],n=Fm(i,e.humanoid,e.meta.metaVersion);if(t.push(...n.translation.values()),t.push(...n.rotation.values()),e.expressionManager!=null){let s=Um(i,e.expressionManager);t.push(...s.preset.values()),t.push(...s.custom.values())}if(e.lookAt!=null){let s=e.scene.children.find(a=>a instanceof Ou);s==null?(console.warn("createVRMAnimationClip: VRMLookAtQuaternionProxy is not found. Creating a new one automatically. To suppress this warning, create a VRMLookAtQuaternionProxy manually"),s=new Ou(e.lookAt),s.name="VRMLookAtQuaternionProxy",e.scene.add(s)):s.name===""&&(console.warn("createVRMAnimationClip: VRMLookAtQuaternionProxy is found but its name is not set. Setting the name automatically. To suppress this warning, set the name manually"),s.name="VRMLookAtQuaternionProxy");let r=Om(i,`${s.name}.quaternion`);r!=null&&t.push(r)}return new Qt("Clip",i.duration,t)}function Am(i,e){let t=i.length,n=[],s=[],r=0;for(let a=0;a<t;a++){let o=i[a];r<=0&&(r=e,s=[],n.push(s)),s.push(o),r--}return n}var um,Cn,dm,Wl,pm,Ma,Ow,Bw,Rm,mm,gm,_m,Lm,bm,Hw,zw,km,XE,jE,YE,xm,KE,JE,$E,ZE,QE,eT,tT,nT,iT,ym,sT,rT,Vw,Ww,wm,qw,Xw,jw,Yw,ku,Mm,Kw,Du,Dm,Jw,$w,ii,gr,Rn,Zw,Qw,Sm,Nu,Ou,Bm,tM,Sa,Fu,Em,nM,iM,sM,rM,zm=rt(()=>{at();at();at();at();at();at();at();at();at();at();at();at();at();at();at();at();at();um=(i,e,t)=>new Promise((n,s)=>{var r=l=>{try{o(t.next(l))}catch(c){s(c)}},a=l=>{try{o(t.throw(l))}catch(c){s(c)}},o=l=>l.done?n(l.value):Promise.resolve(l.value).then(r,a);o((t=t.apply(i,e)).next())}),Cn=(i,e,t)=>new Promise((n,s)=>{var r=l=>{try{o(t.next(l))}catch(c){s(c)}},a=l=>{try{o(t.throw(l))}catch(c){s(c)}},o=l=>l.done?n(l.value):Promise.resolve(l.value).then(r,a);o((t=t.apply(i,e)).next())}),dm=class extends nt{constructor(i){super(),this.weight=0,this.isBinary=!1,this.overrideBlink="none",this.overrideLookAt="none",this.overrideMouth="none",this._binds=[],this.name=`VRMExpression_${i}`,this.expressionName=i,this.type="VRMExpression",this.visible=!1}get binds(){return this._binds}get overrideBlinkAmount(){return this.overrideBlink==="block"?0<this.outputWeight?1:0:this.overrideBlink==="blend"?this.outputWeight:0}get overrideLookAtAmount(){return this.overrideLookAt==="block"?0<this.outputWeight?1:0:this.overrideLookAt==="blend"?this.outputWeight:0}get overrideMouthAmount(){return this.overrideMouth==="block"?0<this.outputWeight?1:0:this.overrideMouth==="blend"?this.outputWeight:0}get outputWeight(){return this.isBinary?this.weight>.5?1:0:this.weight}addBind(i){this._binds.push(i)}deleteBind(i){let e=this._binds.indexOf(i);e>=0&&this._binds.splice(e,1)}applyWeight(i){var e;let t=this.outputWeight;t*=(e=i?.multiplier)!=null?e:1,this.isBinary&&t<1&&(t=0),this._binds.forEach(n=>n.applyWeight(t))}clearAppliedWeight(){this._binds.forEach(i=>i.clearAppliedWeight())}};Wl={Aa:"aa",Ih:"ih",Ou:"ou",Ee:"ee",Oh:"oh",Blink:"blink",Happy:"happy",Angry:"angry",Sad:"sad",Relaxed:"relaxed",LookUp:"lookUp",Surprised:"surprised",LookDown:"lookDown",LookLeft:"lookLeft",LookRight:"lookRight",BlinkLeft:"blinkLeft",BlinkRight:"blinkRight",Neutral:"neutral"};pm=class Tm{constructor(){this.blinkExpressionNames=["blink","blinkLeft","blinkRight"],this.lookAtExpressionNames=["lookLeft","lookRight","lookUp","lookDown"],this.mouthExpressionNames=["aa","ee","ih","oh","ou"],this._expressions=[],this._expressionMap={}}get expressions(){return this._expressions.concat()}get expressionMap(){return Object.assign({},this._expressionMap)}get presetExpressionMap(){let e={},t=new Set(Object.values(Wl));return Object.entries(this._expressionMap).forEach(([n,s])=>{t.has(n)&&(e[n]=s)}),e}get customExpressionMap(){let e={},t=new Set(Object.values(Wl));return Object.entries(this._expressionMap).forEach(([n,s])=>{t.has(n)||(e[n]=s)}),e}copy(e){return this._expressions.concat().forEach(n=>{this.unregisterExpression(n)}),e._expressions.forEach(n=>{this.registerExpression(n)}),this.blinkExpressionNames=e.blinkExpressionNames.concat(),this.lookAtExpressionNames=e.lookAtExpressionNames.concat(),this.mouthExpressionNames=e.mouthExpressionNames.concat(),this}clone(){return new Tm().copy(this)}getExpression(e){var t;return(t=this._expressionMap[e])!=null?t:null}registerExpression(e){this._expressions.push(e),this._expressionMap[e.expressionName]=e}unregisterExpression(e){let t=this._expressions.indexOf(e);t===-1&&console.warn("VRMExpressionManager: The specified expressions is not registered"),this._expressions.splice(t,1),delete this._expressionMap[e.expressionName]}getValue(e){var t;let n=this.getExpression(e);return(t=n?.weight)!=null?t:null}setValue(e,t){let n=this.getExpression(e);n&&(n.weight=Uw(t))}resetValues(){this._expressions.forEach(e=>{e.weight=0})}getExpressionTrackName(e){let t=this.getExpression(e);return t?`${t.name}.weight`:null}update(){let e=this._calculateWeightMultipliers();this._expressions.forEach(t=>{t.clearAppliedWeight()}),this._expressions.forEach(t=>{let n=1,s=t.expressionName;this.blinkExpressionNames.indexOf(s)!==-1&&(n*=e.blink),this.lookAtExpressionNames.indexOf(s)!==-1&&(n*=e.lookAt),this.mouthExpressionNames.indexOf(s)!==-1&&(n*=e.mouth),t.applyWeight({multiplier:n})})}_calculateWeightMultipliers(){let e=1,t=1,n=1;return this._expressions.forEach(s=>{e-=s.overrideBlinkAmount,t-=s.overrideLookAtAmount,n-=s.overrideMouthAmount}),e=Math.max(0,e),t=Math.max(0,t),n=Math.max(0,n),{blink:e,lookAt:t,mouth:n}}},Ma={Color:"color",EmissionColor:"emissionColor",ShadeColor:"shadeColor",MatcapColor:"matcapColor",RimColor:"rimColor",OutlineColor:"outlineColor"},Ow={_Color:Ma.Color,_EmissionColor:Ma.EmissionColor,_ShadeColor:Ma.ShadeColor,_RimColor:Ma.RimColor,_OutlineColor:Ma.OutlineColor},Bw=new Ee,Rm=class Cm{constructor({material:e,type:t,targetValue:n,targetAlpha:s}){this.material=e,this.type=t,this.targetValue=n,this.targetAlpha=s??1;let r=this._initColorBindState(),a=this._initAlphaBindState();this._state={color:r,alpha:a}}applyWeight(e){let{color:t,alpha:n}=this._state;if(t!=null){let{propertyName:s,deltaValue:r}=t,a=this.material[s];a?.add(Bw.copy(r).multiplyScalar(e))}if(n!=null){let{propertyName:s,deltaValue:r}=n;this.material[s]!=null&&(this.material[s]+=r*e)}}clearAppliedWeight(){let{color:e,alpha:t}=this._state;if(e!=null){let{propertyName:n,initialValue:s}=e,r=this.material[n];r?.copy(s)}if(t!=null){let{propertyName:n,initialValue:s}=t;this.material[n]!=null&&(this.material[n]=s)}}_initColorBindState(){var e,t,n;let{material:s,type:r,targetValue:a}=this,o=this._getPropertyNameMap(),l=(t=(e=o?.[r])==null?void 0:e[0])!=null?t:null;if(l==null)return console.warn(`Tried to add a material color bind to the material ${(n=s.name)!=null?n:"(no name)"}, the type ${r} but the material or the type is not supported.`),null;let h=s[l].clone(),u=new Ee(a.r-h.r,a.g-h.g,a.b-h.b);return{propertyName:l,initialValue:h,deltaValue:u}}_initAlphaBindState(){var e,t,n;let{material:s,type:r,targetAlpha:a}=this,o=this._getPropertyNameMap(),l=(t=(e=o?.[r])==null?void 0:e[1])!=null?t:null;if(l==null&&a!==1)return console.warn(`Tried to add a material alpha bind to the material ${(n=s.name)!=null?n:"(no name)"}, the type ${r} but the material or the type does not support alpha.`),null;if(l==null)return null;let c=s[l],h=a-c;return{propertyName:l,initialValue:c,deltaValue:h}}_getPropertyNameMap(){var e,t;return(t=(e=Object.entries(Cm._propertyNameMapMap).find(([n])=>this.material[n]===!0))==null?void 0:e[1])!=null?t:null}};Rm._propertyNameMapMap={isMeshStandardMaterial:{color:["color","opacity"],emissionColor:["emissive",null]},isMeshBasicMaterial:{color:["color","opacity"]},isMToonMaterial:{color:["color","opacity"],emissionColor:["emissive",null],outlineColor:["outlineColorFactor",null],matcapColor:["matcapFactor",null],rimColor:["parametricRimColorFactor",null],shadeColor:["shadeColorFactor",null]}};mm=Rm,gm=class{constructor({primitives:i,index:e,weight:t}){this.primitives=i,this.index=e,this.weight=t}applyWeight(i){this.primitives.forEach(e=>{var t;((t=e.morphTargetInfluences)==null?void 0:t[this.index])!=null&&(e.morphTargetInfluences[this.index]+=this.weight*i)})}clearAppliedWeight(){this.primitives.forEach(i=>{var e;((e=i.morphTargetInfluences)==null?void 0:e[this.index])!=null&&(i.morphTargetInfluences[this.index]=0)})}},_m=new Ie,Lm=class Pm{constructor({material:e,scale:t,offset:n}){var s,r;this.material=e,this.scale=t,this.offset=n;let a=(s=Object.entries(Pm._propertyNamesMap).find(([o])=>e[o]===!0))==null?void 0:s[1];a==null?(console.warn(`Tried to add a texture transform bind to the material ${(r=e.name)!=null?r:"(no name)"} but the material is not supported.`),this._properties=[]):(this._properties=[],a.forEach(o=>{var l;let c=(l=e[o])==null?void 0:l.clone();if(!c)return null;e[o]=c;let h=c.offset.clone(),u=c.repeat.clone(),d=n.clone().sub(h),f=t.clone().sub(u);this._properties.push({name:o,initialOffset:h,deltaOffset:d,initialScale:u,deltaScale:f})}))}applyWeight(e){this._properties.forEach(t=>{let n=this.material[t.name];n!==void 0&&(n.offset.add(_m.copy(t.deltaOffset).multiplyScalar(e)),n.repeat.add(_m.copy(t.deltaScale).multiplyScalar(e)))})}clearAppliedWeight(){this._properties.forEach(e=>{let t=this.material[e.name];t!==void 0&&(t.offset.copy(e.initialOffset),t.repeat.copy(e.initialScale))})}};Lm._propertyNamesMap={isMeshStandardMaterial:["map","emissiveMap","bumpMap","normalMap","displacementMap","roughnessMap","metalnessMap","alphaMap"],isMeshBasicMaterial:["map","specularMap","alphaMap"],isMToonMaterial:["map","normalMap","emissiveMap","shadeMultiplyTexture","rimMultiplyTexture","outlineWidthMultiplyTexture","uvAnimationMaskTexture"]};bm=Lm,Hw=new Set(["1.0","1.0-beta"]),zw=class Im{get name(){return"VRMExpressionLoaderPlugin"}constructor(e){this.parser=e}afterRoot(e){return Cn(this,null,function*(){e.userData.vrmExpressionManager=yield this._import(e)})}_import(e){return Cn(this,null,function*(){let t=yield this._v1Import(e);if(t)return t;let n=yield this._v0Import(e);return n||null})}_v1Import(e){return Cn(this,null,function*(){var t,n;let s=this.parser.json;if(!(((t=s.extensionsUsed)==null?void 0:t.indexOf("VRMC_vrm"))!==-1))return null;let a=(n=s.extensions)==null?void 0:n.VRMC_vrm;if(!a)return null;let o=a.specVersion;if(!Hw.has(o))return console.warn(`VRMExpressionLoaderPlugin: Unknown VRMC_vrm specVersion "${o}"`),null;let l=a.expressions;if(!l)return null;let c=new Set(Object.values(Wl)),h=new Map;l.preset!=null&&Object.entries(l.preset).forEach(([d,f])=>{if(f!=null){if(!c.has(d)){console.warn(`VRMExpressionLoaderPlugin: Unknown preset name "${d}" detected. Ignoring the expression`);return}h.set(d,f)}}),l.custom!=null&&Object.entries(l.custom).forEach(([d,f])=>{if(c.has(d)){console.warn(`VRMExpressionLoaderPlugin: Custom expression cannot have preset name "${d}". Ignoring the expression`);return}h.set(d,f)});let u=new pm;return yield Promise.all(Array.from(h.entries()).map(d=>Cn(this,[d],function*([f,m]){var b,g,p,x,w,y,S;let E=new dm(f);if(e.scene.add(E),E.isBinary=(b=m.isBinary)!=null?b:!1,E.overrideBlink=(g=m.overrideBlink)!=null?g:"none",E.overrideLookAt=(p=m.overrideLookAt)!=null?p:"none",E.overrideMouth=(x=m.overrideMouth)!=null?x:"none",(w=m.morphTargetBinds)==null||w.forEach(_=>Cn(this,null,function*(){var A;if(_.node===void 0||_.index===void 0)return;let k=yield fm(e,_.node),R=_.index;if(!k.every(D=>Array.isArray(D.morphTargetInfluences)&&R<D.morphTargetInfluences.length)){console.warn(`VRMExpressionLoaderPlugin: ${m.name} attempts to index morph #${R} but not found.`);return}E.addBind(new gm({primitives:k,index:R,weight:(A=_.weight)!=null?A:1}))})),m.materialColorBinds||m.textureTransformBinds){let _=[];e.scene.traverse(A=>{let k=A.material;k&&(Array.isArray(k)?_.push(...k):_.push(k))}),(y=m.materialColorBinds)==null||y.forEach(A=>Cn(this,null,function*(){_.filter(R=>{var D;let B=(D=this.parser.associations.get(R))==null?void 0:D.materials;return A.material===B}).forEach(R=>{E.addBind(new mm({material:R,type:A.type,targetValue:new Ee().fromArray(A.targetValue),targetAlpha:A.targetValue[3]}))})})),(S=m.textureTransformBinds)==null||S.forEach(A=>Cn(this,null,function*(){_.filter(R=>{var D;let B=(D=this.parser.associations.get(R))==null?void 0:D.materials;return A.material===B}).forEach(R=>{var D,B;E.addBind(new bm({material:R,offset:new Ie().fromArray((D=A.offset)!=null?D:[0,0]),scale:new Ie().fromArray((B=A.scale)!=null?B:[1,1])}))})}))}u.registerExpression(E)}))),u})}_v0Import(e){return Cn(this,null,function*(){var t;let n=this.parser.json,s=(t=n.extensions)==null?void 0:t.VRM;if(!s)return null;let r=s.blendShapeMaster;if(!r)return null;let a=new pm,o=r.blendShapeGroups;if(!o)return a;let l=new Set;return yield Promise.all(o.map(c=>Cn(this,null,function*(){var h;let u=c.presetName,d=u!=null&&Im.v0v1PresetNameMap[u]||null,f=d??c.name;if(f==null){console.warn("VRMExpressionLoaderPlugin: One of custom expressions has no name. Ignoring the expression");return}if(l.has(f)){console.warn(`VRMExpressionLoaderPlugin: An expression preset ${u} has duplicated entries. Ignoring the expression`);return}l.add(f);let m=new dm(f);e.scene.add(m),m.isBinary=(h=c.isBinary)!=null?h:!1,c.binds&&c.binds.forEach(g=>Cn(this,null,function*(){var p;if(g.mesh===void 0||g.index===void 0)return;let x=[];if((p=n.nodes)==null||p.forEach((y,S)=>{y.mesh===g.mesh&&x.push(S)}),x.length===0){console.warn(`VRMExpressionLoaderPlugin: ${c.name} attempts to bind a morph target to the mesh #${g.mesh} but the mesh is not found or not used in the scene. Ignoring the bind.`);return}let w=g.index;yield Promise.all(x.map(y=>Cn(this,null,function*(){var S;let E=yield fm(e,y);if(!E.every(_=>Array.isArray(_.morphTargetInfluences)&&w<_.morphTargetInfluences.length)){console.warn(`VRMExpressionLoaderPlugin: ${c.name} attempts to index ${w}th morph but not found.`);return}m.addBind(new gm({primitives:E,index:w,weight:.01*((S=g.weight)!=null?S:100)}))})))}));let b=c.materialValues;b&&b.length!==0&&b.forEach(g=>{if(g.materialName===void 0||g.propertyName===void 0||g.targetValue===void 0)return;let p=[];e.scene.traverse(w=>{if(w.material){let y=w.material;Array.isArray(y)?p.push(...y.filter(S=>(S.name===g.materialName||S.name===g.materialName+" (Outline)")&&p.indexOf(S)===-1)):y.name===g.materialName&&p.indexOf(y)===-1&&p.push(y)}});let x=g.propertyName;p.forEach(w=>{if(x==="_MainTex_ST"){let S=new Ie(g.targetValue[0],g.targetValue[1]),E=new Ie(g.targetValue[2],g.targetValue[3]);E.y=1-E.y-S.y,m.addBind(new bm({material:w,scale:S,offset:E}));return}let y=Ow[x];if(y){m.addBind(new mm({material:w,type:y,targetValue:new Ee().fromArray(g.targetValue),targetAlpha:g.targetValue[3]}));return}console.warn(x+" is not supported")})}),a.registerExpression(m)}))),a})}};zw.v0v1PresetNameMap={a:"aa",e:"ee",i:"ih",o:"oh",u:"ou",blink:"blink",joy:"happy",angry:"angry",sorrow:"sad",fun:"relaxed",lookup:"lookUp",lookdown:"lookDown",lookleft:"lookLeft",lookright:"lookRight",blink_l:"blinkLeft",blink_r:"blinkRight",neutral:"neutral"};km=class _r{constructor(e,t){this._firstPersonOnlyLayer=_r.DEFAULT_FIRSTPERSON_ONLY_LAYER,this._thirdPersonOnlyLayer=_r.DEFAULT_THIRDPERSON_ONLY_LAYER,this._initializedLayers=!1,this.humanoid=e,this.meshAnnotations=t}copy(e){if(this.humanoid!==e.humanoid)throw new Error("VRMFirstPerson: humanoid must be same in order to copy");return this.meshAnnotations=e.meshAnnotations.map(t=>({meshes:t.meshes.concat(),type:t.type})),this}clone(){return new _r(this.humanoid,this.meshAnnotations).copy(this)}get firstPersonOnlyLayer(){return this._firstPersonOnlyLayer}get thirdPersonOnlyLayer(){return this._thirdPersonOnlyLayer}setup({firstPersonOnlyLayer:e=_r.DEFAULT_FIRSTPERSON_ONLY_LAYER,thirdPersonOnlyLayer:t=_r.DEFAULT_THIRDPERSON_ONLY_LAYER}={}){this._initializedLayers||(this._firstPersonOnlyLayer=e,this._thirdPersonOnlyLayer=t,this.meshAnnotations.forEach(n=>{n.meshes.forEach(s=>{n.type==="firstPersonOnly"?(s.layers.set(this._firstPersonOnlyLayer),s.traverse(r=>r.layers.set(this._firstPersonOnlyLayer))):n.type==="thirdPersonOnly"?(s.layers.set(this._thirdPersonOnlyLayer),s.traverse(r=>r.layers.set(this._thirdPersonOnlyLayer))):n.type==="auto"&&this._createHeadlessModel(s)})}),this._initializedLayers=!0)}_excludeTriangles(e,t,n,s){let r=0;if(t!=null&&t.length>0)for(let a=0;a<e.length;a+=3){let o=e[a],l=e[a+1],c=e[a+2],h=t[o],u=n[o];if(h[0]>0&&s.includes(u[0])||h[1]>0&&s.includes(u[1])||h[2]>0&&s.includes(u[2])||h[3]>0&&s.includes(u[3]))continue;let d=t[l],f=n[l];if(d[0]>0&&s.includes(f[0])||d[1]>0&&s.includes(f[1])||d[2]>0&&s.includes(f[2])||d[3]>0&&s.includes(f[3]))continue;let m=t[c],b=n[c];m[0]>0&&s.includes(b[0])||m[1]>0&&s.includes(b[1])||m[2]>0&&s.includes(b[2])||m[3]>0&&s.includes(b[3])||(e[r++]=o,e[r++]=l,e[r++]=c)}return r}_createErasedMesh(e,t){let n=new ss(e.geometry.clone(),e.material);n.name=`${e.name}(erase)`,n.frustumCulled=e.frustumCulled,n.layers.set(this._firstPersonOnlyLayer);let s=n.geometry,r=s.getAttribute("skinIndex"),a=r instanceof rr?[]:r.array,o=[];for(let b=0;b<a.length;b+=4)o.push([a[b],a[b+1],a[b+2],a[b+3]]);let l=s.getAttribute("skinWeight"),c=l instanceof rr?[]:l.array,h=[];for(let b=0;b<c.length;b+=4)h.push([c[b],c[b+1],c[b+2],c[b+3]]);let u=s.getIndex();if(!u)throw new Error("The geometry doesn't have an index buffer");let d=Array.from(u.array),f=this._excludeTriangles(d,h,o,t),m=[];for(let b=0;b<f;b++)m[b]=d[b];return s.setIndex(m),e.onBeforeRender&&(n.onBeforeRender=e.onBeforeRender),n.bind(new rs(e.skeleton.bones,e.skeleton.boneInverses),new ke),n}_createHeadlessModelForSkinnedMesh(e,t){let n=[];if(t.skeleton.bones.forEach((r,a)=>{this._isEraseTarget(r)&&n.push(a)}),!n.length){t.layers.enable(this._thirdPersonOnlyLayer),t.layers.enable(this._firstPersonOnlyLayer);return}t.layers.set(this._thirdPersonOnlyLayer);let s=this._createErasedMesh(t,n);e.add(s)}_createHeadlessModel(e){if(e.type==="Group")if(e.layers.set(this._thirdPersonOnlyLayer),this._isEraseTarget(e))e.traverse(t=>t.layers.set(this._thirdPersonOnlyLayer));else{let t=new Pt;t.name=`_headless_${e.name}`,t.layers.set(this._firstPersonOnlyLayer),e.parent.add(t),e.children.filter(n=>n.type==="SkinnedMesh").forEach(n=>{let s=n;this._createHeadlessModelForSkinnedMesh(t,s)})}else if(e.type==="SkinnedMesh"){let t=e;this._createHeadlessModelForSkinnedMesh(e.parent,t)}else this._isEraseTarget(e)&&(e.layers.set(this._thirdPersonOnlyLayer),e.traverse(t=>t.layers.set(this._thirdPersonOnlyLayer)))}_isEraseTarget(e){return e===this.humanoid.getRawBoneNode("head")?!0:e.parent?this._isEraseTarget(e.parent):!1}};km.DEFAULT_FIRSTPERSON_ONLY_LAYER=9;km.DEFAULT_THIRDPERSON_ONLY_LAYER=10;XE=new L,jE=new L,YE=new _e,xm={hips:null,spine:"hips",chest:"spine",upperChest:"chest",neck:"upperChest",head:"neck",leftEye:"head",rightEye:"head",jaw:"head",leftUpperLeg:"hips",leftLowerLeg:"leftUpperLeg",leftFoot:"leftLowerLeg",leftToes:"leftFoot",rightUpperLeg:"hips",rightLowerLeg:"rightUpperLeg",rightFoot:"rightLowerLeg",rightToes:"rightFoot",leftShoulder:"upperChest",leftUpperArm:"leftShoulder",leftLowerArm:"leftUpperArm",leftHand:"leftLowerArm",rightShoulder:"upperChest",rightUpperArm:"rightShoulder",rightLowerArm:"rightUpperArm",rightHand:"rightLowerArm",leftThumbMetacarpal:"leftHand",leftThumbProximal:"leftThumbMetacarpal",leftThumbDistal:"leftThumbProximal",leftIndexProximal:"leftHand",leftIndexIntermediate:"leftIndexProximal",leftIndexDistal:"leftIndexIntermediate",leftMiddleProximal:"leftHand",leftMiddleIntermediate:"leftMiddleProximal",leftMiddleDistal:"leftMiddleIntermediate",leftRingProximal:"leftHand",leftRingIntermediate:"leftRingProximal",leftRingDistal:"leftRingIntermediate",leftLittleProximal:"leftHand",leftLittleIntermediate:"leftLittleProximal",leftLittleDistal:"leftLittleIntermediate",rightThumbMetacarpal:"rightHand",rightThumbProximal:"rightThumbMetacarpal",rightThumbDistal:"rightThumbProximal",rightIndexProximal:"rightHand",rightIndexIntermediate:"rightIndexProximal",rightIndexDistal:"rightIndexIntermediate",rightMiddleProximal:"rightHand",rightMiddleIntermediate:"rightMiddleProximal",rightMiddleDistal:"rightMiddleIntermediate",rightRingProximal:"rightHand",rightRingIntermediate:"rightRingProximal",rightRingDistal:"rightRingIntermediate",rightLittleProximal:"rightHand",rightLittleIntermediate:"rightLittleProximal",rightLittleDistal:"rightLittleIntermediate"};KE=new L,JE=new _e,$E=new L,ZE=new _e,QE=new L,eT=new _e,tT=new _e,nT=new L,iT=new L,ym=Math.sqrt(2)/2,sT=new _e(0,0,-ym,ym),rT=new L(0,1,0),Vw=new L,Ww=new L;wm=new L(0,0,1),qw=new L,Xw=new L,jw=new L,Yw=new _e,ku=new _e,Mm=new _e,Kw=new _e,Du=new Dt,Dm=class Nm{constructor(e,t){this.offsetFromHeadBone=new L,this.autoUpdate=!0,this.faceFront=new L(0,0,1),this.humanoid=e,this.applier=t,this._yaw=0,this._pitch=0,this._needsUpdate=!0,this._restHeadWorldQuaternion=this.getLookAtWorldQuaternion(new _e)}get yaw(){return this._yaw}set yaw(e){this._yaw=e,this._needsUpdate=!0}get pitch(){return this._pitch}set pitch(e){this._pitch=e,this._needsUpdate=!0}get euler(){return console.warn("VRMLookAt: euler is deprecated. use getEuler() instead."),this.getEuler(new Dt)}getEuler(e){return e.set(dt.DEG2RAD*this._pitch,dt.DEG2RAD*this._yaw,0,"YXZ")}copy(e){if(this.humanoid!==e.humanoid)throw new Error("VRMLookAt: humanoid must be same in order to copy");return this.offsetFromHeadBone.copy(e.offsetFromHeadBone),this.applier=e.applier,this.autoUpdate=e.autoUpdate,this.target=e.target,this.faceFront.copy(e.faceFront),this}clone(){return new Nm(this.humanoid,this.applier).copy(this)}reset(){this._yaw=0,this._pitch=0,this._needsUpdate=!0}getLookAtWorldPosition(e){let t=this.humanoid.getRawBoneNode("head");return e.copy(this.offsetFromHeadBone).applyMatrix4(t.matrixWorld)}getLookAtWorldQuaternion(e){let t=this.humanoid.getRawBoneNode("head");return Uu(t,e)}getFaceFrontQuaternion(e){if(this.faceFront.distanceToSquared(wm)<.01)return e.copy(this._restHeadWorldQuaternion).invert();let[t,n]=Vl(this.faceFront);return Du.set(0,.5*Math.PI+t,n,"YZX"),e.setFromEuler(Du).premultiply(Kw.copy(this._restHeadWorldQuaternion).invert())}getLookAtWorldDirection(e){return this.getLookAtWorldQuaternion(ku),this.getFaceFrontQuaternion(Mm),e.copy(wm).applyQuaternion(ku).applyQuaternion(Mm).applyEuler(this.getEuler(Du))}lookAt(e){let t=Yw.copy(this._restHeadWorldQuaternion).multiply(Gw(this.getLookAtWorldQuaternion(ku))),n=this.getLookAtWorldPosition(Xw),s=jw.copy(e).sub(n).applyQuaternion(t).normalize(),[r,a]=Vl(this.faceFront),[o,l]=Vl(s),c=vm(o-r),h=vm(a-l);this._yaw=dt.RAD2DEG*c,this._pitch=dt.RAD2DEG*h,this._needsUpdate=!0}update(e){this.target!=null&&this.autoUpdate&&this.lookAt(this.target.getWorldPosition(qw)),this._needsUpdate&&(this._needsUpdate=!1,this.applier.applyYawPitch(this._yaw,this._pitch))}};Dm.EULER_ORDER="YXZ";Jw=Dm,$w=new L(0,0,1),ii=new _e,gr=new _e,Rn=new Dt(0,0,0,"YXZ"),Zw=class{constructor(i,e,t,n,s){this.humanoid=i,this.rangeMapHorizontalInner=e,this.rangeMapHorizontalOuter=t,this.rangeMapVerticalDown=n,this.rangeMapVerticalUp=s,this.faceFront=new L(0,0,1),this._restQuatLeftEye=new _e,this._restQuatRightEye=new _e,this._restLeftEyeParentWorldQuat=new _e,this._restRightEyeParentWorldQuat=new _e;let r=this.humanoid.getRawBoneNode("leftEye"),a=this.humanoid.getRawBoneNode("rightEye");r&&(this._restQuatLeftEye.copy(r.quaternion),Uu(r.parent,this._restLeftEyeParentWorldQuat)),a&&(this._restQuatRightEye.copy(a.quaternion),Uu(a.parent,this._restRightEyeParentWorldQuat))}applyYawPitch(i,e){let t=this.humanoid.getRawBoneNode("leftEye"),n=this.humanoid.getRawBoneNode("rightEye"),s=this.humanoid.getNormalizedBoneNode("leftEye"),r=this.humanoid.getNormalizedBoneNode("rightEye");t&&(e<0?Rn.x=-dt.DEG2RAD*this.rangeMapVerticalDown.map(-e):Rn.x=dt.DEG2RAD*this.rangeMapVerticalUp.map(e),i<0?Rn.y=-dt.DEG2RAD*this.rangeMapHorizontalInner.map(-i):Rn.y=dt.DEG2RAD*this.rangeMapHorizontalOuter.map(i),ii.setFromEuler(Rn),this._getWorldFaceFrontQuat(gr),s.quaternion.copy(gr).multiply(ii).multiply(gr.invert()),ii.copy(this._restLeftEyeParentWorldQuat),t.quaternion.copy(s.quaternion).multiply(ii).premultiply(ii.invert()).multiply(this._restQuatLeftEye)),n&&(e<0?Rn.x=-dt.DEG2RAD*this.rangeMapVerticalDown.map(-e):Rn.x=dt.DEG2RAD*this.rangeMapVerticalUp.map(e),i<0?Rn.y=-dt.DEG2RAD*this.rangeMapHorizontalOuter.map(-i):Rn.y=dt.DEG2RAD*this.rangeMapHorizontalInner.map(i),ii.setFromEuler(Rn),this._getWorldFaceFrontQuat(gr),r.quaternion.copy(gr).multiply(ii).multiply(gr.invert()),ii.copy(this._restRightEyeParentWorldQuat),n.quaternion.copy(r.quaternion).multiply(ii).premultiply(ii.invert()).multiply(this._restQuatRightEye))}lookAt(i){console.warn("VRMLookAtBoneApplier: lookAt() is deprecated. use apply() instead.");let e=dt.RAD2DEG*i.y,t=dt.RAD2DEG*i.x;this.applyYawPitch(e,t)}_getWorldFaceFrontQuat(i){if(this.faceFront.distanceToSquared($w)<.01)return i.identity();let[e,t]=Vl(this.faceFront);return Rn.set(0,.5*Math.PI+e,t,"YZX"),i.setFromEuler(Rn)}};Zw.type="bone";Qw=class{constructor(i,e,t,n,s){this.expressions=i,this.rangeMapHorizontalInner=e,this.rangeMapHorizontalOuter=t,this.rangeMapVerticalDown=n,this.rangeMapVerticalUp=s}applyYawPitch(i,e){e<0?(this.expressions.setValue("lookDown",0),this.expressions.setValue("lookUp",this.rangeMapVerticalUp.map(-e))):(this.expressions.setValue("lookUp",0),this.expressions.setValue("lookDown",this.rangeMapVerticalDown.map(e))),i<0?(this.expressions.setValue("lookLeft",0),this.expressions.setValue("lookRight",this.rangeMapHorizontalOuter.map(-i))):(this.expressions.setValue("lookRight",0),this.expressions.setValue("lookLeft",this.rangeMapHorizontalOuter.map(i)))}lookAt(i){console.warn("VRMLookAtBoneApplier: lookAt() is deprecated. use apply() instead.");let e=dt.RAD2DEG*i.y,t=dt.RAD2DEG*i.x;this.applyYawPitch(e,t)}};Qw.type="expression";Sm=180/Math.PI,Nu=new Dt,Ou=class extends nt{constructor(i){super(),this.vrmLookAt=i,this.type="VRMLookAtQuaternionProxy";let e=this.rotation._onChangeCallback;this.rotation._onChange(()=>{e(),this._applyToLookAt()});let t=this.quaternion._onChangeCallback;this.quaternion._onChange(()=>{t(),this._applyToLookAt()})}_applyToLookAt(){Nu.setFromQuaternion(this.quaternion,Jw.EULER_ORDER),this.vrmLookAt.yaw=Sm*Nu.y,this.vrmLookAt.pitch=Sm*Nu.x}};Bm=class{constructor(){this.duration=0,this.restHipsPosition=new L,this.humanoidTracks={translation:new Map,rotation:new Map},this.expressionTracks={preset:new Map,custom:new Map},this.lookAtTrack=null}};tM=new ke,Sa=new L,Fu=new _e,Em=new _e,nM=new _e,iM=new Set(["1.0","1.0-draft"]),sM=new Set(Object.values(Wl)),rM=class{constructor(i){this.parser=i}get name(){return"VRMC_vrm_animation"}afterRoot(i){return um(this,null,function*(){var e,t,n;let s=i.parser.json,r=s.extensionsUsed;if(r==null||r.indexOf(this.name)==-1)return;let a=(e=s.extensions)==null?void 0:e[this.name];if(a==null)return;let o=a.specVersion;if(o==null)console.warn("VRMAnimationLoaderPlugin: specVersion of the VRMA is not defined. Consider updating the animation file. Assuming the spec version is 1.0.");else{if(!iM.has(o)){console.warn(`VRMAnimationLoaderPlugin: Unknown VRMC_vrm_animation spec version: ${o}`);return}o==="1.0-draft"&&console.warn("VRMAnimationLoaderPlugin: Using a draft spec version: 1.0-draft. Some behaviors may be different. Consider updating the animation file.")}let l=this._createNodeMap(a),c=yield this._createBoneWorldMatrixMap(i,a),h=(n=(t=a.humanoid)==null?void 0:t.humanBones.hips)==null?void 0:n.node,u=h!=null?yield i.parser.getDependency("node",h):null,d=new L;u?.getWorldPosition(d),d.y<.001&&console.warn("VRMAnimationLoaderPlugin: The loaded VRM Animation might violate the VRM T-pose (The y component of the rest hips position is approximately zero or below.)");let m=i.animations.map((b,g)=>{let p=s.animations[g],x=this._parseAnimation(b,p,l,c);return x.restHipsPosition=d,x});i.userData.vrmAnimations=m})}_createNodeMap(i){var e,t,n,s,r;let a=new Map,o=new Map,l=(e=i.humanoid)==null?void 0:e.humanBones;l&&Object.entries(l).forEach(([d,f])=>{let m=f?.node;m!=null&&a.set(m,d)});let c=(t=i.expressions)==null?void 0:t.preset;c&&Object.entries(c).forEach(([d,f])=>{let m=f?.node;m!=null&&o.set(m,d)});let h=(n=i.expressions)==null?void 0:n.custom;h&&Object.entries(h).forEach(([d,f])=>{let{node:m}=f;o.set(m,d)});let u=(r=(s=i.lookAt)==null?void 0:s.node)!=null?r:null;return{humanoidIndexToName:a,expressionsIndexToName:o,lookAtIndex:u}}_createBoneWorldMatrixMap(i,e){return um(this,null,function*(){var t,n;i.scene.updateWorldMatrix(!1,!0);let s=yield i.parser.getDependencies("node"),r=new Map;if(e.humanoid==null)return r;for(let[a,o]of Object.entries(e.humanoid.humanBones)){let l=o?.node;if(l!=null){let c=s[l];r.set(a,c.matrixWorld),a==="hips"&&r.set("hipsParent",(n=(t=c.parent)==null?void 0:t.matrixWorld)!=null?n:tM)}}return r})}_parseAnimation(i,e,t,n){let s=i.tracks,r=e.channels,a=new Bm;return a.duration=i.duration,r.forEach((o,l)=>{let{node:c,path:h}=o.target,u=s[l];if(c==null)return;let d=t.humanoidIndexToName.get(c);if(d!=null){let m=xm[d];for(;m!=null&&n.get(m)==null;)m=xm[m];if(m==null&&(m="hipsParent"),h==="translation")if(d!=="hips")console.warn(`The loading animation contains a translation track for ${d}, which is not permitted in the VRMC_vrm_animation spec. ignoring the track`);else{let b=n.get("hipsParent"),g=Am(u.values,3).flatMap(x=>Sa.fromArray(x).applyMatrix4(b).toArray()),p=u.clone();p.values=new Float32Array(g),a.humanoidTracks.translation.set(d,p)}else if(h==="rotation"){let b=n.get(d),g=n.get(m);b.decompose(Sa,Fu,Sa),Fu.invert(),g.decompose(Sa,Em,Sa);let p=Am(u.values,4).flatMap(w=>nM.fromArray(w).premultiply(Em).multiply(Fu).toArray()),x=u.clone();x.values=new Float32Array(p),a.humanoidTracks.rotation.set(d,x)}else throw new Error(`Invalid path "${h}"`);return}let f=t.expressionsIndexToName.get(c);if(f!=null){if(h==="translation"){let m=u.times,b=new Float32Array(u.values.length/3);for(let p=0;p<b.length;p++)b[p]=u.values[3*p];let g=new Un(`${f}.weight`,m,b);sM.has(f)?a.expressionTracks.preset.set(f,g):a.expressionTracks.custom.set(f,g)}else throw new Error(`Invalid path "${h}"`);return}if(c===t.lookAtIndex)if(h==="rotation")a.lookAtTrack=u;else throw new Error(`Invalid path "${h}"`)}),a}};});function oM(i,e,t){if(!i||!e||!t)return null;let n=t.get("Hips");if(!n)return null;let s=e.getObjectByName(n);if(!s)return null;let r=i.tracks.find(d=>d.name===`${n}.quaternion`);if(!r||r.values.length<4)return null;let a=r.values,o=s.quaternion.x,l=s.quaternion.y,c=s.quaternion.z,h=s.quaternion.w;s.quaternion.set(a[0],a[1],a[2],a[3]),s.updateWorldMatrix(!0,!1),s.getWorldQuaternion(Vm),Gm.copy(Wm).applyQuaternion(Vm),s.quaternion.set(o,l,c,h),s.updateWorldMatrix(!0,!1);let u=Math.max(-1,Math.min(1,Gm.dot(Wm)));return Math.acos(u)*180/Math.PI}function hM(i){let e=!1,t=new Set;return i.traverse(n=>{if(n.isSkinnedMesh&&(e=!0),n.name){let s=pn(n.name);s&&t.add(s)}}),e&&t.size>=lM}function uM(i){try{let e=typeof window<"u"&&typeof window.reportClientError=="function"?window.reportClientError:null;if(!e)return;e(new Error("fallen-pose retarget"),i)}catch(e){mn.warn("[AnimationManager] fallen-pose report failed:",e)}}var aM,Gm,Vm,Wm,lM,cM,qm,ql,Aa,Xm=rt(()=>{"use strict";at();Ul();nm();cm();hm();aM=45,Gm=new L,Vm=new _e,Wm=new L(0,1,0);lM=8,cM=Object.freeze(["Hips","LeftUpLeg","LeftLeg","LeftFoot","LeftToeBase","RightUpLeg","RightLeg","RightFoot","RightToeBase"]),qm=.35,ql=new Map,Aa=class i{constructor(){this.model=null,this.mixer=null,this.clips=new Map,this.actions=new Map,this.currentName=null,this.currentAction=null,this.onChange=null,this._animationDefs=[],this._failed=new Set,this._canonicalToNode=null,this._canonicalClipsSupported=!1,this._vrm=null,this._avatarContext={},this._fallenReported=new Set,this._fallen=new Set,this._latestCrossfadeTarget=null,this.overlayAction=null,this.overlayName=null,this._overlayClips=new Map,this._overlayFinishHandler=null,this._settleFinishHandler=null}setAvatarContext(e){this._avatarContext=e&&typeof e=="object"?{...e}:{}}attach(e,t){this.detach(),t&&this.setAvatarContext(t),this.model=e,this.mixer=new ls(e),this.actions.clear(),this.currentAction=null,this.currentName=null,this._fallen.clear(),this._canonicalToNode=jp(e),this._canonicalRest=Yp(e),this._canonicalWorldRest=Kp(e),this._canonicalRestDirections=Jp(e),this._hipsParentWorldQuat=Zp(e),this._morphTargets=$p(e),this._hipTargetLocalY=Cu(e),this._hipGroundLocalY=Lu(e),this._canonicalClipsSupported=hM(e),this._vrm=e?.userData?.vrm||null;for(let[n,s]of this.clips){let r=this._retarget(s);if(!r)continue;let a=this.mixer.clipAction(r);a.enabled=!0,this.actions.set(n,a)}}remeasureRigProportions(){if(!this.model||!this.mixer)return!1;let e=this.currentName;this._hipTargetLocalY=Cu(this.model),this._hipGroundLocalY=Lu(this.model),this.mixer.stopAllAction();for(let t of this.actions.values()){let n=t.getClip?.();n&&this.mixer.uncacheClip(n)}this.actions.clear(),this.currentAction=null,this.currentName=null,this._latestCrossfadeTarget=null,this.overlayAction=null,this.overlayName=null,this._overlayClips.clear(),this._detachOverlayFinish?.();for(let[t,n]of this.clips){let s=this._retarget(n);if(!s)continue;let r=this.mixer.clipAction(s);r.enabled=!0,this.actions.set(t,r)}return e&&this.actions.has(e)&&this.play(e),!0}_retarget(e){if(!this._canonicalToNode||this._canonicalToNode.size===0)return null;let t=1,n=em(e);this._hipTargetLocalY>.05&&n>.05&&(t=Math.min(200,Math.max(.2,this._hipTargetLocalY/n)));let{clip:s}=tm(e,this._canonicalToNode,{targetRest:this._canonicalRest,targetWorldRest:this._canonicalWorldRest,targetRestDirections:this._canonicalRestDirections,hipsParentWorldQuat:this._hipsParentWorldQuat,morphTargets:this._morphTargets,hipScale:t,hipOffsetY:this._hipGroundLocalY||0});return s}_guardAgainstFallenPose(e,t){if(this._fallen.has(e))return!1;let n=t?.getClip?.(),s=oM(n,this.model,this._canonicalToNode);if(s==null||!Number.isFinite(s)||s<=aM)return!0;try{t.stop()}catch(l){mn.warn("[AnimationManager] failed to stop fallen-pose action:",l)}t.enabled=!1,this.actions.delete(e),this._fallen.add(e),this.currentAction===t&&(this.currentAction=null,this.currentName=null);let r=this._avatarContext.avatarUrl||"",a=this._avatarContext.avatarId||"",o=`${a||r}|${e}`;return this._fallenReported.has(o)||(this._fallenReported.add(o),mn.warn(`[AnimationManager] "${e}" retargeted to a fallen pose (${s.toFixed(1)}\xB0 off vertical) \u2014 falling back to bind pose`),uM({avatarId:a,avatarUrl:r,clip:e,tiltDeg:Math.round(s*10)/10})),!1}detach(){this.mixer&&(this.mixer.stopAllAction(),this.mixer.uncacheRoot(this.mixer.getRoot()),this.mixer=null),this.model=null,this._canonicalToNode=null,this._canonicalRest=null,this._canonicalWorldRest=null,this._canonicalRestDirections=null,this._hipsParentWorldQuat=null,this._morphTargets=null,this._hipTargetLocalY=0,this._hipGroundLocalY=0,this._canonicalClipsSupported=!1,this._vrm=null,this.actions.clear(),this.currentAction=null,this.currentName=null,this._latestCrossfadeTarget=null,this._fallen.clear(),this.overlayAction=null,this.overlayName=null,this._overlayClips.clear(),this._overlayFinishHandler=null}setAnimationDefs(e){this._animationDefs=e}appendAnimationDefs(e){let t=new Set(this._animationDefs.map(n=>n.name));for(let n of e)t.has(n.name)||(this._animationDefs.push(n),t.add(n.name))}getAnimationDefs(){return this._animationDefs}isFailed(e){return this._failed.has(e)}supportsCanonicalClips(){return this._canonicalClipsSupported}relaxUndrivenArms(){return this.model?lm(this.model,this._canonicalToNode):0}canPlay(e){return this._fallen.has(e)?!1:this.clips.has(e)?!0:this._failed.has(e)?!1:this._animationDefs.some(t=>t.name===e)}async loadAnimation(e,t,n={}){if(this.clips.has(e))return this.clips.get(e);let s=ql.get(t);s||(s=i._fetchClip(e,t),ql.set(t,s),s.catch(()=>{ql.get(t)===s&&ql.delete(t)}));let r=await s;return this._registerParsedClip(e,r,n)}static async _fetchClip(e,t){let n=t.includes("/api/animations/"),s=new AbortController,r=setTimeout(()=>s.abort(),15e3),a;try{a=await fetch(t,{signal:s.signal,credentials:n?"include":"same-origin",redirect:"error"})}finally{clearTimeout(r)}if(!a.ok)throw new Error(`HTTP ${a.status} loading animation ${e}`);let o=await a.json(),l=n?o?.clip?.clip:o;if(!l&&o?.clip?.paywalled)throw new Error(`animation ${e} is a paid clip, unlock it at ${o.clip.download_url}`);if(!l)throw new Error(`clip payload missing from ${t}`);let c=Qt.parse(l);return c.name=e,c}injectClip(e,t,n={}){if(!(!t||this.clips.has(e)))try{let s=Qt.parse(t);s.name=e,this._registerParsedClip(e,s,n)}catch(s){mn.warn(`[AnimationManager] injectClip "${e}" parse error:`,s.message)}}async loadVrmaAnimation(e,t,n={}){if(this.clips.has(e))return this.clips.get(e);let[{GLTFLoader:s},{VRMAnimationLoaderPlugin:r}]=await Promise.all([Promise.resolve().then(()=>(Su(),Dp)),Promise.resolve().then(()=>(zm(),Hm))]),a=new s;a.register(u=>new r(u));let l=(await a.loadAsync(t)).userData?.vrmAnimations?.[0];if(!l)throw new Error(`${t} has no VRM animation data`);let c=[];for(let[u,d]of l.humanoidTracks.rotation.entries()){let f=d.clone();f.name=`${u}.quaternion`,c.push(f)}for(let[u,d]of l.humanoidTracks.translation.entries()){let f=d.clone();f.name=`${u}.position`,c.push(f)}if(!c.length)throw new Error(`${t} has no humanoid bone tracks`);let h=new Qt(e,l.duration,c);return this._registerParsedClip(e,h,n)}_registerParsedClip(e,t,n){if(this.clips.set(e,t),this.model&&this.mixer){let s=this._retarget(t);if(s){let r=this.mixer.clipAction(s);r.enabled=!0,r.setLoop(n.loop===!1?Hi:ps),n.loop===!1&&(r.clampWhenFinished=!0),this.actions.set(e,r)}}return t}async loadAll(){let t=[...this._animationDefs],n=async()=>{let s;for(;s=t.shift();)try{await this.loadAnimation(s.name,s.url,{loop:s.loop!==!1})}catch(r){mn.warn(`[AnimationManager] failed to load "${s.name}":`,r.message),this._failed.add(s.name)}};await Promise.all(Array.from({length:4},n))}async ensureLoaded(e){if(this.clips.has(e))return!0;if(this._failed.has(e))return!1;let t=this._animationDefs.find(n=>n.name===e);if(!t)return!1;try{return await this.loadAnimation(t.name,t.url,{loop:t.loop!==!1}),!0}catch{return this._failed.add(e),!1}}async play(e){if(!await this.ensureLoaded(e))return(this._failed.has(e)||this._animationDefs.some(s=>s.name===e))&&mn.warn(`[AnimationManager] "${e}" unavailable`),!1;if(e===this.currentName)return!0;let n=this.actions.get(e);if(!n||!this._guardAgainstFallenPose(e,n))return!1;this.currentAction&&this.currentAction!==n&&this.currentAction.fadeOut(.01),n.reset().fadeIn(.01).play(),this.currentAction=n,this.currentName=e;try{this.onChange?.(e)}catch(s){mn.warn("[AnimationManager] onChange threw:",s)}return!0}async playOnce(e,{settleTo:t="idle",fade:n=qm,fadeIn:s=n}={}){n=Math.max(0,Math.min(n,5)),s=Math.max(0,Math.min(s,5));let a=await this.ensureLoaded(e)?this.actions.get(e):null;if(!a||!this._guardAgainstFallenPose(e,a))return t?this.crossfadeTo(t,s):void 0;if(a.reset(),a.setLoop(Hi,1),a.clampWhenFinished=!0,a.play(),this.currentAction&&this.currentAction!==a?this.currentAction.crossFadeTo(a,s,!0):a.fadeIn(s),this.currentAction=a,this.currentName=e,this._settleFinishHandler&&this.mixer&&(this.mixer.removeEventListener("finished",this._settleFinishHandler),this._settleFinishHandler=null),t&&this.mixer){let o=l=>{l.action===a&&(this.mixer.removeEventListener("finished",o),this._settleFinishHandler===o&&(this._settleFinishHandler=null),this.currentAction===a&&this.crossfadeTo(t,n))};this._settleFinishHandler=o,this.mixer.addEventListener("finished",o)}try{this.onChange?.(e)}catch(o){mn.warn("[AnimationManager] onChange threw:",o)}}freeze(){this.currentAction&&(this.currentAction.paused=!0),this.currentAction=null,this.currentName=null,this._latestCrossfadeTarget=null}async crossfadeTo(e,t=qm){if(t=Math.max(0,Math.min(t,5)),e===this.currentName)return;if(this._latestCrossfadeTarget=e,!await this.ensureLoaded(e)){(this._failed.has(e)||this._animationDefs.some(r=>r.name===e))&&mn.warn(`[AnimationManager] "${e}" unavailable`);return}if(this._latestCrossfadeTarget!==e||e===this.currentName)return;let s=this.actions.get(e);if(s&&this._guardAgainstFallenPose(e,s)){s.reset().play(),this.currentAction&&this.currentAction!==s?this.currentAction.crossFadeTo(s,t,!0):s.fadeIn(t),this.currentAction=s,this.currentName=e;try{this.onChange?.(e)}catch(r){mn.warn("[AnimationManager] onChange threw:",r)}}}_buildOverlayClip(e,t){let n=`${e}|${t?"upper":"full"}`,s=this._overlayClips.get(n);if(s)return s;let r=this.clips.get(e);if(!r)return null;let a=this._retarget(r);if(!a)return null;let o=a.tracks;if(t&&this._canonicalToNode){let c=new Set;for(let h of cM){let u=this._canonicalToNode.get(h);u&&c.add(u)}if(o=o.filter(h=>{let u=h.name.split(".")[0];return!c.has(u)}),o.length===0)return null}let l=new Qt(`${e}__additive`,a.duration,o);return $r.makeClipAdditive(l),this._overlayClips.set(n,l),l}async playOverlay(e,{loop:t=!1,crossfade:n=.25,upperBodyOnly:s=!0,timeScale:r=1,onFinished:a=null}={}){if(n=Math.max(0,Math.min(n,5)),!await this.ensureLoaded(e)||!this.mixer)return!1;let l=this._buildOverlayClip(e,s);if(!l)return!1;let c=this.mixer.clipAction(l,void 0,da);this._detachOverlayFinish();let h=this.overlayAction;if(h&&h!==c&&h.fadeOut(n),c.enabled=!0,c.setLoop(t?ps:Hi,t?1/0:1),c.clampWhenFinished=!t,c.setEffectiveTimeScale(r),c.reset(),c.setEffectiveWeight(1),c.fadeIn(n),c.play(),this.overlayAction=c,this.overlayName=e,!t){let u=d=>{if(d.action===c){this.mixer.removeEventListener("finished",u),this._overlayFinishHandler===u&&(this._overlayFinishHandler=null),this.overlayAction===c&&(c.fadeOut(n),this.overlayAction=null,this.overlayName=null);try{a?.(e)}catch(f){mn.warn("[AnimationManager] overlay onFinished threw:",f)}}};this._overlayFinishHandler=u,this.mixer.addEventListener("finished",u)}return!0}_detachOverlayFinish(){this._overlayFinishHandler&&this.mixer&&this.mixer.removeEventListener("finished",this._overlayFinishHandler),this._overlayFinishHandler=null}stopOverlay({crossfade:e=.2}={}){e=Math.max(0,Math.min(e,5)),this._detachOverlayFinish(),this.overlayAction&&(this.overlayAction.fadeOut(e),this.overlayAction=null,this.overlayName=null)}hasOverlay(){return this.overlayAction!=null}setSpeed(e){this.currentAction?.setEffectiveTimeScale(e)}stopAll(){this.mixer?.stopAllAction(),this._detachOverlayFinish(),this.currentAction=null,this.currentName=null,this.overlayAction=null,this.overlayName=null;try{this.onChange?.(null)}catch(e){mn.warn("[AnimationManager] onChange threw:",e)}}update(e){this.mixer?.update(e),this._vrm?.update(e)}getLoadedNames(){return[...this.clips.keys()]}isLoaded(e){return this.clips.has(e)}dispose(){this.detach(),this.clips.clear(),this._animationDefs=[],this._failed.clear()}}});var jm=rt(()=>{"use strict";Ul()});var Ym=rt(()=>{"use strict"});var dM,RT,CT,LT,PT,IT,kT,DT,NT,FT,UT,OT,Km=rt(()=>{"use strict";at();jm();Ym();dM=Math.PI/180,RT=120*dM,CT=new L,LT=new L,PT=new _e,IT=new _e,kT=new _e,DT=new _e,NT=new _e,FT=new _e,UT=new _e,OT=new Dt});var Bu=rt(()=>{"use strict";Xm();Km()});function Jm(i,e,t){let n=new URL(e,t||(typeof location<"u"?location.href:"http://localhost/"));return i.map(s=>s&&typeof s.url=="string"?{...s,url:new URL(s.url,n).href}:s)}var $m=rt(()=>{"use strict"});function jl(i){return i&&pM.get(i)||null}function zu(i,{name:e,accent:t}={}){return{id:i,name:e||"Your avatar",emoji:"\u2728",blurb:"Your own avatar, retargeted to the shared motion library.",category:"Yours",asset:null,source:"api",rig:"shared",clips:Gn,accent:t||"#7aa2ff",tags:["custom","user"]}}function Yl(i,{assetBase:e="",apiBase:t=""}={}){return i?i.source==="api"?`${t}/api/avatars/${encodeURIComponent(i.id)}/glb`:i.asset?/^https?:\/\//i.test(i.asset)?i.asset:`${e}${i.asset}`:null:null}var Hu,Gn,Ea,Xl,pM,Kl=rt(()=>{"use strict";Hu="robot",Gn={idle:"idle",walk:"av-walk-feminine",run:"av-walk-feminine",wave:"wave",jump:"jump"},Ea={dance:"dance",punch:"av-muay-thai",backflip:"av-back-flip",wave:"wave"},Xl=[{id:"robot",name:"Robo",emoji:"\u{1F916}",blurb:"The friendly platform mascot. Expressive, lightweight, always game.",category:"Mascots",asset:"/animations/robotexpressive.glb",source:"static",rig:"embedded",thumb:"/avatars/thumbs/robotexpressive.png",accent:"#7aa2ff",tags:["mascot","robot","lightweight","default"]},{id:"guide",name:"Guide",emoji:"\u{1F9ED}",blurb:"A clean humanoid guide, driven by the shared motion library.",category:"Humanoid",asset:"/avatars/default.glb",source:"static",rig:"shared",clips:Gn,thumb:"/avatars/thumbs/default.png",accent:"#8bd5ca",tags:["humanoid","neutral","guide"]},{id:"michelle",name:"Michelle",emoji:"\u{1F483}",blurb:"Stylised dancer rig, fully retargeted so she struts \u2014 never poses.",category:"Humanoid",asset:"/avatars/michelle.glb",source:"static",rig:"shared",clips:{...Gn,wave:"michelle-samba-dance"},emotes:{...Ea,dance:"michelle-samba-dance"},accent:"#ff8fab",tags:["humanoid","feminine","dancer"]},{id:"mannequin",name:"Mannequin",emoji:"\u{1F9CD}",blurb:"A neutral artist mannequin \u2014 the blank canvas of the cast.",category:"Humanoid",asset:"/avatars/mannequin.glb",source:"static",rig:"shared",clips:Gn,accent:"#c9b8a8",tags:["humanoid","neutral","mannequin"]},{id:"xbot",name:"X-Bot",emoji:"\u{1F9BE}",blurb:"Mixamo X-Bot with its own idle/walk/run set for snappy motion.",category:"Humanoid",asset:"/avatars/xbot.glb",source:"static",rig:"shared",clips:{idle:"xbot-idle",walk:"xbot-walk",run:"xbot-run",wave:"wave",jump:"jump"},accent:"#9aa7b5",tags:["humanoid","robot","mixamo"]},{id:"realistic-female",name:"Ava",emoji:"\u{1F469}",blurb:"Photoreal full-body avatar, retargeted to the shared library.",category:"Realistic",asset:"/avatars/realistic-female.glb",source:"static",rig:"shared",clips:Gn,accent:"#f2a65a",tags:["realistic","feminine","rpm"]},{id:"realistic-male",name:"Leo",emoji:"\u{1F468}",blurb:"Photoreal full-body avatar, retargeted to the shared library.",category:"Realistic",asset:"/avatars/realistic-male.glb",source:"static",rig:"shared",clips:Gn,accent:"#6ea8fe",tags:["realistic","masculine","rpm"]},{id:"selfie-girl",name:"Mira",emoji:"\u{1F933}",blurb:"Selfie-styled avatar \u2014 playful, expressive, photo-ready.",category:"Realistic",asset:"/avatars/selfie-girl.glb",source:"static",rig:"shared",clips:Gn,accent:"#d39bff",tags:["realistic","feminine","rpm"]},{id:"fox",name:"Fox",emoji:"\u{1F98A}",blurb:"The classic glTF fox \u2014 a non-humanoid pal that trots and surveys.",category:"Creatures",asset:"/avatars/fox.glb",source:"static",rig:"embedded",clips:{idle:["Survey"],walk:["Walk"],run:["Run"]},accent:"#ff9f43",tags:["creature","animal","quadruped"]},{id:"twerk",name:"Groove",emoji:"\u{1F57A}",blurb:"A dancer who never stops moving \u2014 pure ambient energy.",category:"Showpieces",asset:"/avatars/dancing-twerk.glb",source:"static",rig:"embedded",accent:"#ff5e7e",tags:["dancer","loop","fun"]},{id:"cesium",name:"Cesium",emoji:"\u{1F6B6}",blurb:"The reference walking man \u2014 a tireless, steady stroller.",category:"Showpieces",asset:"/avatars/cesium-man.glb",source:"static",rig:"embedded",accent:"#54c7ec",tags:["reference","walk"]},{id:"brainstem",name:"Stem",emoji:"\u{1F9BF}",blurb:"A skeletal showpiece rig with a hypnotic walk cycle.",category:"Showpieces",asset:"/avatars/brainstem.glb",source:"static",rig:"embedded",accent:"#a0e7a0",tags:["showpiece","skeletal"]},{id:"cz",name:"CZ",emoji:"\u{1F9D1}\u200D\u{1F4BC}",blurb:"A stylised character bust with a calm, animated idle.",category:"Showpieces",asset:"/avatars/cz.glb",source:"static",rig:"embedded",thumb:"/avatars/thumbs/cz.png",accent:"#ffd166",tags:["showpiece","idle"]}],pM=new Map(Xl.map(i=>[i.id,i]))});function ng(i,e=Ea){let t=new Set(i),n={};for(let[s,r]of Object.entries(e))r&&t.has(r)&&(n[s]=r);return n}async function _M(){return Gu||(Gu=(async()=>{let i=new xa;return i.setMeshoptDecoder(await Up()),i})()),Gu}function Zm(i,e){let t=Jl.get(i);if(t)return t.then(s=>({value:s,owner:!1}));let n=e();return Jl.set(i,n),n.finally(()=>{Jl.get(i)===n&&Jl.delete(i)}).catch(()=>{}),n.then(s=>({value:s,owner:!0}))}function Qm(i){return{...i,scene:i.scene.clone(!0)}}async function xs(i,e={}){let{assetBase:t="",apiBase:n="",manifestUrl:s="/animations/manifest.json",fallbackEntry:r=null,waveMs:a=mM}=e,o=await _M(),l=Yl(i,{assetBase:t,apiBase:n});if(!l)throw new Error(`walk: cannot resolve a GLB url for avatar "${i?.id}"`);let c=i,h;try{let f=await Zm(l,()=>o.loadAsync(l));h=f.owner?f.value:Qm(f.value)}catch(f){if(r&&r.id!==i.id){zn.warn(`avatar "${i?.id}" failed to load \u2014 falling back to "${r.id}"`,f?.message||f),c=r;let m=Yl(r,{assetBase:t,apiBase:n}),b=await Zm(m,()=>o.loadAsync(m));h=b.owner?b.value:Qm(b.value)}else throw f}let u=h.scene;u.traverse(f=>{f.isMesh&&(f.frustumCulled=!1)});let d;try{c.rig==="shared"?d=await bM(u,c.clips||Gn,{manifestUrl:s,waveMs:a,emotes:c.emotes}):d=eg(u,h.animations||[],c.clips||{},{waveMs:a})}catch(f){if(f?.code===ig)if(h.animations&&h.animations.length)zn.debug(`avatar "${c.id}" isn't a retargetable humanoid \u2014 driving its ${h.animations.length} baked clip(s) instead`),d=eg(u,h.animations,{},{waveMs:a});else{if(r&&r.id!==c.id)return zn.debug(`avatar "${c.id}" can't be animated (non-humanoid rig, no baked clips) \u2014 falling back to "${r.id}"`),Vu(u),xs(r,{...e,fallbackEntry:null});throw Vu(u),f}else throw Vu(u),f}return{model:u,controller:d,gltf:h,entry:c}}function Vu(i){i.traverse(e=>{if(!e.isMesh)return;e.geometry?.dispose?.();let t=Array.isArray(e.material)?e.material:[e.material];for(let n of t)if(n){for(let s of Object.values(n))s&&s.isTexture&&s.dispose();n.dispose?.()}})}function eg(i,e,t,{waveMs:n}){let s=new ls(i),r=w=>e.find(y=>y.name.toLowerCase()===String(w).toLowerCase()),a=w=>{for(let y of w){let S=r(y);if(S)return S}return null},o=w=>Array.isArray(t?.[w])?t[w]:[],l=a([...o("idle"),"Idle","idle"])||e[0]||null,c={idle:l,walk:a([...o("walk"),"Walking","Walk","walk"])||l,run:a([...o("run"),"Running","Run","run","Walking","walk"])||l,jump:a([...o("jump"),"Jump","jump","WalkJump"])||null,wave:a([...o("wave"),"Wave","wave"])||null},h={};for(let[w,y]of Object.entries(gM)){let S=a([...o(w),...y]);S&&(h[w]=S)}let u={};for(let[w,y]of Object.entries(c)){if(!y)continue;let S=s.clipAction(y);S.enabled=!0,u[w]=S}let d={};for(let[w,y]of Object.entries(h)){let S=s.clipAction(y);S.enabled=!0,d[w]=S}let f="idle",m="idle",b=null,g=!1;function p(w,{once:y=!1,dur:S=.3}={}){w&&(w.reset(),w.setLoop(y?Hi:ps,y?1:1/0),w.clampWhenFinished=y,w.fadeIn(S).play(),b&&b!==w&&b.fadeOut(S),b=w)}function x(w,y){p(u[w]||u.idle,y)}return s.addEventListener("finished",()=>{g&&(g=!1,x(f,{dur:.25}))}),x("idle",{dur:0}),{setState(w){if(w!==m){if(m=w,w==="jump"){u.jump&&(g=!0,x("jump",{once:!0,dur:.12}));return}f=w,g||x(f,{dur:.22})}},emotes(){return Object.keys(d)},playEmote(w){let y=d[w];if(!y)return!1;g=!0,p(y,{once:!0,dur:.2});let S=y.getClip().duration*1e3||n;return clearTimeout(this._emoteGuard),this._emoteGuard=setTimeout(()=>{g&&(g=!1,x(f,{dur:.25}))},Math.min(S,tg)+250),!0},playWave(){g||this.playEmote("wave")},setSpeed(w){s.timeScale=w>0?w:1},update(w){s.update(w)},dispose(){clearTimeout(this._emoteGuard),s.stopAllAction(),s.uncacheRoot(i)}}}async function bM(i,e,{manifestUrl:t,waveMs:n,emotes:s}){let r=new Aa;if(r.attach(i),!r.supportsCanonicalClips()){r.dispose();let f=new Error("walk: rig is not a retargetable humanoid (no skinned skeleton) \u2014 cannot drive shared clips");throw f.code=ig,f}let a={},o={},l=new Map;try{let f=await fetch(t,{cache:"force-cache"}).then(g=>{if(!g.ok)throw new Error(`HTTP ${g.status} fetching animation manifest`);return g.json()}).then(g=>Jm(g,t)),m=new Set(f.map(g=>g.name));for(let g of f)l.set(g.name,(Number(g.duration)||0)*1e3);for(let[g,p]of Object.entries({...Gn,...e}))a[g]=m.has(p)?p:null;if(a.idle=a.idle||(m.has("idle")?"idle":null),!a.idle)throw new Error("animation manifest missing an idle clip");for(let g of Object.keys(a))a[g]||(a[g]=a.idle);o=ng(m,{...Ea,...s||{}});let b=new Set([...Object.values(a),...Object.values(o)]);r.setAnimationDefs(f.filter(g=>b.has(g.name))),await r.loadAll()}catch(f){throw r.dispose(),f}let c="idle",h=null,u=(f,m)=>Promise.resolve(r.crossfadeTo(f,m)).catch(()=>{}),d=f=>a[f]||a.idle;return u(a.idle,0),{setState(f){f!==c&&(c=f,h||u(d(f),f==="jump"?.12:.3))},emotes(){return Object.keys(o)},playEmote(f){let m=o[f];if(!m||m===a.idle)return!1;clearTimeout(h),u(m,.25);let b=l.get(m)||n;return h=setTimeout(()=>{h=null,u(d(c),.3)},Math.min(b,tg)+150),!0},playWave(){if(h||this.playEmote("wave"))return;let f=a.wave;!f||f===a.idle||(u(f,.25),h=setTimeout(()=>{h=null,u(d(c),.3)},n))},setSpeed(f){r.mixer&&(r.mixer.timeScale=f>0?f:1)},update(f){r.update(f)},dispose(){clearTimeout(h),r.dispose()}}}var mM,tg,gM,ig,Gu,Jl,$l=rt(()=>{"use strict";at();Su();Op();Bu();$m();Cl();Kl();mM=1500,tg=8e3,gM={dance:["Dance"],punch:["Punch"],backflip:["Backflip","BackFlip","Back Flip","back_flip"],wave:["Wave"]};ig="WALK_RIG_UNSUPPORTED",Gu=null;Jl=new Map});function xM(){if(sg||typeof document>"u")return;sg=!0;let i=document.createElement("style");i.id="walk-picker-style",i.textContent=`
.walk-picker{position:fixed;z-index:2147483200;width:320px;max-width:calc(100vw - 24px);max-height:min(70vh,560px);display:flex;flex-direction:column;background:rgba(16,18,26,.97);color:#eef1f6;border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.5);backdrop-filter:blur(10px);opacity:0;transform:translateY(8px) scale(.98);transform-origin:bottom right;transition:opacity .2s ease,transform .2s ease;font:400 13px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;overflow:hidden}
.walk-picker.is-in{opacity:1;transform:translateY(0) scale(1)}
.walk-picker-head{display:flex;align-items:center;gap:8px;padding:12px 12px 8px}
.walk-picker-title{font-weight:700;font-size:13.5px;letter-spacing:.01em}
.walk-picker-title small{display:block;font-weight:400;font-size:11px;color:#9aa3b2;margin-top:1px}
.walk-picker-close{margin-left:auto;width:26px;height:26px;border:none;border-radius:8px;background:rgba(255,255,255,.06);color:#cfd6e2;font-size:16px;line-height:1;cursor:pointer;display:grid;place-items:center;transition:background .15s ease}
.walk-picker-close:hover{background:rgba(255,255,255,.14)}
.walk-picker-close:focus-visible{outline:2px solid #7aa2ff;outline-offset:2px}
.walk-picker-search{margin:0 12px 8px;display:flex;align-items:center;gap:7px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:7px 10px}
.walk-picker-search:focus-within{border-color:rgba(122,162,255,.7)}
.walk-picker-search input{flex:1;min-width:0;background:none;border:none;outline:none;color:#eef1f6;font:inherit}
.walk-picker-search input::placeholder{color:#7e8696}
.walk-picker-list{overflow-y:auto;padding:0 12px 12px;scrollbar-width:thin}
.walk-picker-cat{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#7e8696;margin:12px 2px 7px}
.walk-picker-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.walk-picker-tile{position:relative;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px 6px 8px;cursor:pointer;background:rgba(255,255,255,.02);text-align:center;transition:transform .12s ease,border-color .15s ease,background .15s ease;color:inherit;font:inherit;display:flex;flex-direction:column;align-items:center;gap:5px;overflow:hidden}
.walk-picker-tile:hover{transform:translateY(-2px);background:rgba(255,255,255,.06)}
.walk-picker-tile:focus-visible{outline:2px solid #7aa2ff;outline-offset:1px}
.walk-picker-tile.is-active{border-color:var(--wp-accent,#7aa2ff);background:rgba(122,162,255,.12)}
.walk-picker-tile.is-active::after{content:'\u2713';position:absolute;top:5px;right:6px;font-size:11px;color:var(--wp-accent,#7aa2ff)}
.walk-picker-orb{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;font-size:22px;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.35),transparent 60%),var(--wp-accent,#7aa2ff);box-shadow:inset 0 -6px 12px rgba(0,0,0,.25);background-size:cover;background-position:center}
.walk-picker-name{font-size:11.5px;font-weight:600;line-height:1.1}
.walk-picker-empty{padding:24px 8px;text-align:center;color:#7e8696;font-size:12.5px}
.walk-picker-foot{padding:8px 12px;border-top:1px solid rgba(255,255,255,.08);font-size:11px;color:#7e8696;display:flex;justify-content:space-between;gap:8px}
.walk-picker-foot a{color:#9bb8ff;text-decoration:none}
.walk-picker-foot a:hover{text-decoration:underline}
@media (max-width:520px){.walk-picker{width:calc(100vw - 24px)}.walk-picker-grid{grid-template-columns:repeat(4,1fr)}}
@media (prefers-reduced-motion:reduce){.walk-picker,.walk-picker-tile{transition:none}}
`,document.head.appendChild(i)}function Zl(i){xM();let{avatars:e=[],onSelect:t,anchor:n={right:16,bottom:16},assetBase:s="",docsUrl:r}=i,a=i.currentId||null,o="",l=document.createElement("div");l.className="walk-picker",l.setAttribute("role","dialog"),l.setAttribute("aria-label","Choose your walking avatar"),l.style.right=`${n.right}px`,l.style.bottom=`${n.bottom}px`,l.innerHTML=`
		<div class="walk-picker-head">
			<div class="walk-picker-title">Walking avatar<small>Pick who roams your pages</small></div>
			<button type="button" class="walk-picker-close" aria-label="Close avatar picker">\xD7</button>
		</div>
		<label class="walk-picker-search">
			<span aria-hidden="true">\u{1F50D}</span>
			<input type="search" placeholder="Search avatars\u2026" aria-label="Search avatars" />
		</label>
		<div class="walk-picker-list" role="listbox" aria-label="Avatars"></div>
		${r?`<div class="walk-picker-foot"><span>${e.length} avatars</span><a href="${r}">Make your own \u2192</a></div>`:""}
	`;let c=l.querySelector(".walk-picker-list"),h=l.querySelector(".walk-picker-search input"),u=l.querySelector(".walk-picker-close");function d(S){let E=document.createElement("button");E.type="button",E.className="walk-picker-tile"+(S.id===a?" is-active":""),E.setAttribute("role","option"),E.setAttribute("aria-selected",String(S.id===a)),E.dataset.id=S.id,E.title=S.blurb||S.name,S.accent&&E.style.setProperty("--wp-accent",S.accent);let _=S.thumb?` style="background-image:url('${s}${S.thumb}')"`:"";E.innerHTML=`<span class="walk-picker-orb"${_}>${S.thumb?"":S.emoji||"\u{1F9CD}"}</span>`;let A=document.createElement("span");return A.className="walk-picker-name",A.textContent=S.name,E.appendChild(A),E.addEventListener("click",()=>m(S)),E}function f(){let S=o.trim().toLowerCase(),E=e.filter(A=>S?A.name.toLowerCase().includes(S)||A.category.toLowerCase().includes(S)||(A.tags||[]).some(k=>k.includes(S)):!0);if(c.innerHTML="",!E.length){let A=document.createElement("div");A.className="walk-picker-empty",A.textContent=`No avatars match \u201C${o}\u201D.`,c.appendChild(A);return}let _=[];for(let A of E)_.includes(A.category)||_.push(A.category);for(let A of _){let k=document.createElement("div");k.className="walk-picker-cat",k.textContent=A,c.appendChild(k);let R=document.createElement("div");R.className="walk-picker-grid";for(let D of E.filter(B=>B.category===A))R.appendChild(d(D));c.appendChild(R)}}function m(S){a=S.id,f(),t?.(S),w()}let b=!1,g=S=>{!l.contains(S.target)&&!S.target.closest?.("[data-walk-picker-toggle]")&&w()},p=S=>{if(S.key==="Escape"){S.stopPropagation(),w();return}let E=[...c.querySelectorAll(".walk-picker-tile")],_=E.indexOf(document.activeElement);if(["ArrowRight","ArrowDown","ArrowLeft","ArrowUp"].includes(S.key)&&E.length){S.preventDefault();let A=matchMedia("(max-width:520px)").matches?4:3,k=_;S.key==="ArrowRight"?k=_+1:S.key==="ArrowLeft"?k=_-1:S.key==="ArrowDown"?k=_+A:S.key==="ArrowUp"&&(k=_-A),k=Math.max(0,Math.min(E.length-1,k)),E[k]?.focus()}};h.addEventListener("input",()=>{o=h.value,f()}),u.addEventListener("click",w),l.addEventListener("keydown",p);function x(){b||(b=!0,f(),document.body.appendChild(l),requestAnimationFrame(()=>{l.classList.add("is-in"),Sp()||h.focus()}),setTimeout(()=>document.addEventListener("pointerdown",g,!0),0))}function w(){b&&(b=!1,l.classList.remove("is-in"),document.removeEventListener("pointerdown",g,!0),setTimeout(()=>{!b&&l.parentNode&&l.parentNode.removeChild(l)},200))}function y(){w(),l.removeEventListener("keydown",p)}return{el:l,show:x,close:w,toggle(){b?w():x()},isOpen:()=>b,setCurrent(S){a=S,b&&f()},destroy:y}}var sg,Ql=rt(()=>{"use strict";kl();sg=!1});function Gi(i={}){let e=i.storagePrefix||"walk";return{avatars:i.avatars||Xl,defaultAvatarId:i.defaultAvatarId||Hu,assetBase:i.assetBase||"",apiBase:i.apiBase||"",manifestUrl:i.manifestUrl||"/animations/manifest.json",excludedRoutes:i.excludedRoutes||rg,enablePicker:i.enablePicker!==!1,lookAt:i.lookAt!==!1,greeting:typeof i.greeting=="function"?i.greeting:null,docsUrl:i.docsUrl||null,keys:{enabled:`${e}:companion:enabled`,state:`${e}:companion:state`,avatar:`${e}:companion:avatar`,greet:`${e}:companion:greet`,invited:`${e}:companion:invited`,resume:`${e}:playground:resume`,mode:`${e}:playground:mode`}}}function vi(i,e){if(!i)return jl(e.defaultAvatarId)||e.avatars[0];let t=e.avatars.find(n=>n.id===i)||jl(i);return t||zu(i)}var rg,ec=rt(()=>{"use strict";Kl();rg=["/walk","/walk-embed","/embed","/play","/club","/city","/xr","/ar","/pose","/mocap-studio","/avatar-studio","/studio"]});function DM(){if(dg||typeof document>"u")return;dg=!0;let i=document.createElement("style");i.id="walk-cp-style",i.textContent=`
.walk-cp{position:fixed;z-index:2147483080;width:74px;height:74px;margin:-37px 0 0 -37px;pointer-events:none;display:grid;place-items:center;transition:opacity .3s ease}
.walk-cp__ring{position:absolute;inset:0;border-radius:50%;border:2px dashed rgba(122,162,255,.5);background:radial-gradient(circle,rgba(122,162,255,.16),transparent 68%)}
.walk-cp__num{position:relative;z-index:1;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font:800 14px/1 system-ui,-apple-system,'Segoe UI',sans-serif;color:#fff;background:rgba(20,24,34,.85);border:1px solid rgba(122,162,255,.6);box-shadow:0 4px 14px rgba(0,0,0,.4)}
.walk-cp.is-locked{opacity:.42}
.walk-cp.is-active .walk-cp__ring{border-style:solid;border-color:rgba(110,231,183,.95);background:radial-gradient(circle,rgba(52,211,153,.3),transparent 66%);animation:walk-cp-pulse 1.4s ease-in-out infinite}
.walk-cp.is-active .walk-cp__num{background:linear-gradient(135deg,#34d399,#6ee7b7);color:#06231a;border-color:transparent}
.walk-cp.is-done .walk-cp__ring{border-style:solid;border-color:rgba(110,231,183,.5);background:none;animation:none}
.walk-cp.is-done .walk-cp__num{background:#34d399;color:#06231a;border-color:transparent;font-size:0}
.walk-cp.is-done .walk-cp__num::after{content:'\u2713';font-size:16px}
@keyframes walk-cp-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.14);opacity:.55}}
@media (prefers-reduced-motion:reduce){.walk-cp.is-active .walk-cp__ring{animation:none}}
.walk-pg.is-quest .walk-pg-pick,.walk-pg.is-quest .walk-pg-exit,.walk-pg.is-quest .walk-pg-mode{display:none!important}
`,document.head.appendChild(i)}function mg(i,{checkpoints:e,onReach:t,onComplete:n,startCheckpoint:s}={}){i._checkpoints=Array.isArray(e)&&e.length?e:null,i._onReach=typeof t=="function"?t:null,i._onComplete=typeof n=="function"?n:null,i._activeCp=i._checkpoints?Math.max(0,Math.min(s||0,i._checkpoints.length)):0,i._narrating=!1,i._cpMarkers=[]}function gg(i){i._checkpoints&&(DM(),i._cpMarkers=i._checkpoints.map((e,t)=>{let n=document.createElement("div");return n.className="walk-cp is-locked",n.innerHTML=`<span class="walk-cp__num">${t+1}</span><span class="walk-cp__ring"></span>`,n.setAttribute("aria-hidden","true"),document.body.appendChild(n),n}),_g(i),ju(i))}function _g(i){i._cpMarkers.forEach((e,t)=>{let n=t<i._activeCp;e.classList.toggle("is-done",n),e.classList.toggle("is-active",t===i._activeCp&&!n),e.classList.toggle("is-locked",t>i._activeCp)})}function ju(i){if(i._cpMarkers?.length)for(let e=0;e<i._cpMarkers.length;e++){let t=i._checkpoints[e]?.el,n=i._cpMarkers[e];if(!t||!t.isConnected){n.style.opacity="0";continue}let s=t.getBoundingClientRect(),r=s.left+s.width/2,a=Math.min(window.innerHeight-36,Math.max(36,s.bottom-26));n.style.left=r+"px",n.style.top=a+"px",n.style.opacity=a<-60||a>window.innerHeight+60?"0":""}}function bg(i){let e=i._activeCp,t=i._checkpoints[e]?.el;if(!t||!t.isConnected)return;let n=i.char.x-(window.scrollX||0),s=i.char.y-(window.scrollY||0),r=t.getBoundingClientRect(),a=26;if(n>=r.left-a&&n<=r.right+a&&s>=r.top-a&&s<=r.bottom+a){i._narrating=!0,i.char.vx=0,i.char.vy=0;let o=()=>NM(i);i._onReach?i._onReach(e,o):o()}}function NM(i){i._activeCp++,_g(i),i._narrating=!1,i._activeCp>=i._checkpoints.length&&i._onComplete?.()}function xg(i){i._cpMarkers?.length&&(i._cpMarkers.forEach(e=>e.remove()),i._cpMarkers=[])}function yg(){try{return localStorage.getItem(xt.keys.mode)==="platformer"?"platformer":"stroll"}catch{return"stroll"}}function FM(i){try{localStorage.setItem(xt.keys.mode,i==="platformer"?"platformer":"stroll")}catch{}}function si(){return Math.max(document.documentElement.clientWidth,window.innerWidth||0)}function ys(){let i=document.scrollingElement||document.documentElement;return Math.max(i.scrollHeight,window.innerHeight||0)}function vg(){return Math.max(0,ys()-window.innerHeight)}function UM(i,e){let t=document.elementFromPoint(i,e);if(!t)return null;let n=t.closest?.("a[href]");if(!n||n.target&&n.target!=="_self")return null;let s=n.getAttribute("href")||"";if(!s||s.startsWith("#")||s.startsWith("javascript:"))return null;try{let r=new URL(s,location.href);return r.origin!==location.origin?null:{href:r.href,el:n}}catch{return null}}function wg(i){let e=i==="platformer"?"Platformer":"Stroll";return`<button type="button" class="walk-pg-mode" aria-label="Switch movement mode (currently ${e})" title="Switch mode (M)"><span class="walk-pg-mode-ic" aria-hidden="true">${i==="platformer"?"\u{1F3AE}":"\u{1F6B6}"}</span><span class="walk-pg-mode-tx">${e}</span></button>`}function Mg(){return'<button type="button" class="walk-pg-pick" data-walk-picker-toggle aria-label="Choose your avatar" title="Choose avatar (C)"><span class="walk-pg-pick-ic" aria-hidden="true">\u{1F9D1}</span><span class="walk-pg-pick-tx">Avatar</span></button>'}function Yu(i){if(!i.host)return;i.host.querySelector(".walk-pg-emotes")?.remove();let e=i.controller?.emotes?.()||[],t=Sg.filter(s=>e.includes(s.name));if(!t.length)return;let n=document.createElement("div");n.className="walk-pg-emotes",n.setAttribute("role","toolbar"),n.setAttribute("aria-label","Emotes: make the character perform"),n.innerHTML=t.map(s=>`<button type="button" class="walk-pg-emote" data-emote="${s.name}" aria-label="${s.label}" title="${s.label} (${s.key})"><span aria-hidden="true">${s.icon}</span></button>`).join(""),n.addEventListener("click",s=>{let r=s.target.closest(".walk-pg-emote");r&&Ag(i,r.getAttribute("data-emote"))}),i.host.appendChild(n)}function Ag(i,e){if(i._diving||i._narrating||!i.controller?.playEmote?.(e))return;let t=i.host?.querySelector(`.walk-pg-emote[data-emote="${e}"]`);t&&(t.classList.remove("is-playing"),t.offsetWidth,t.classList.add("is-playing"))}function Eg(i,e){let t=Sg.find(n=>n.key===e);return!t||!i.host?.querySelector(`.walk-pg-emote[data-emote="${t.name}"]`)?!1:(Ag(i,t.name),!0)}function fg(i){i.traverse(e=>{if(!e.isMesh)return;e.geometry?.dispose?.(),(Array.isArray(e.material)?e.material:[e.material]).forEach(n=>{if(n){for(let s of Object.values(n))s&&s.isTexture&&s.dispose();n.dispose?.()}})})}function ic(i){xt.enablePicker!==!1&&(i._picker||(i._picker=Zl({avatars:xt.avatars,currentId:i._avatarId||xt.defaultAvatarId,assetBase:xt.assetBase,docsUrl:xt.docsUrl,onSelect:e=>OM(i,e)})),i._picker.toggle())}async function OM(i,e){let t=typeof e=="string"?vi(e,xt):e;if(!(!t||!i.mounted||!i.rig)&&t.id!==i._avatarId){i._avatarId=t.id;try{localStorage.setItem(xt.keys.avatar,t.id)}catch{}i._picker?.setCurrent(t.id),i._say?.("Switching\u2026",4e3);try{let n=await Ku(t.id,i._charPx);if(!i.mounted||!i.rig){fg(n.model),n.controller?.dispose?.();return}i.model&&(i.rig.remove(i.model),fg(i.model)),i.controller?.dispose?.(),i.rig.add(n.model),i.model=n.model,i.controller=n.controller,i.modelHalfW=n.halfW,typeof i._shadowR=="number"&&(i._shadowR=Math.max(22,n.halfW*1.15)),Yu(i),i._say?.(`Say hi to ${t.name}!`)}catch(n){zn.warn("avatar swap failed:",n?.message||n),i._say?.("Couldn\u2019t load that one \u2014 try another.")}}}function Tg(i){i._picker?.destroy(),i._picker=null}async function Ku(i,e){let t=vi(i,xt),n=vi(xt.defaultAvatarId,xt),{model:s,controller:r}=await xs(t,{assetBase:xt.assetBase,apiBase:xt.apiBase,manifestUrl:xt.manifestUrl,fallbackEntry:n}),o=new bt().setFromObject(s).getSize(new L),l=e/Math.max(.001,o.y);s.scale.setScalar(l);let c=new bt().setFromObject(s),h=c.getCenter(new L);return s.position.x-=h.x,s.position.z-=h.z,s.position.y-=c.min.y,{model:s,controller:r,halfW:o.x*l/2}}function Rg(){let i=typeof navigator<"u"&&navigator.getGamepads?navigator.getGamepads():null;if(!i)return null;let e=null;for(let r of i)if(r&&r.connected){e=r;break}if(!e)return null;let t=e.axes[0]||0,n=e.axes[1]||0,s=r=>!!e.buttons[r]?.pressed;return{left:t<-nc||s(14),right:t>nc||s(15),up:n<-nc||s(12),down:n>nc||s(13),faceA:s(0),faceB:s(1)}}function Cg(i,e,t){for(let n in t)t[n]?(i[n]=!0,e[n]=!0):e[n]&&(i[n]=!1,e[n]=!1)}function Lg(i){try{i.controller?.dispose()}catch{}i.controller=null,i.scene&&i.scene.traverse(e=>{e.isMesh&&(e.geometry?.dispose?.(),(Array.isArray(e.material)?e.material:[e.material]).forEach(n=>{if(n){for(let s of Object.values(n))s&&s.isTexture&&s.dispose();n.dispose?.()}}))}),i.scene=null,i.renderer&&(i.renderer.dispose(),i.renderer.forceContextLoss?.(),i.renderer=null,Xh()),i.host?.parentNode&&i.host.parentNode.removeChild(i.host),i.host=null}function Pg(){if(pg)return;pg=!0;let i=document.createElement("style");i.id="walk-pg-style",i.textContent=`
.walk-pg{position:fixed;inset:0;z-index:2147483100;pointer-events:none;opacity:0;transition:opacity .3s ease}
.walk-pg.is-in{opacity:1}
.walk-pg-canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;filter:drop-shadow(0 18px 22px rgba(0,0,0,.3))}
.walk-pg-exit{position:fixed;top:14px;right:14px;z-index:3;pointer-events:auto;border:1px solid rgba(255,255,255,.16);background:rgba(14,16,22,.72);color:#f2f4f8;font:600 12.5px/1 system-ui,sans-serif;padding:9px 13px;border-radius:999px;cursor:pointer;backdrop-filter:blur(6px);transition:background .2s ease,transform .15s ease}
.walk-pg-exit:hover{background:rgba(220,60,60,.85)}
.walk-pg-exit:active{transform:scale(.96)}
.walk-pg-exit:focus-visible{outline:2px solid #7aa2ff;outline-offset:2px}
.walk-pg-mode{position:fixed;top:14px;right:92px;z-index:3;pointer-events:auto;display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.16);background:rgba(14,16,22,.72);color:#f2f4f8;font:600 12.5px/1 system-ui,sans-serif;padding:9px 13px;border-radius:999px;cursor:pointer;backdrop-filter:blur(6px);transition:background .2s ease,transform .15s ease}
.walk-pg-mode:hover{background:rgba(122,162,255,.55)}
.walk-pg-mode:active{transform:scale(.96)}
.walk-pg-mode:focus-visible{outline:2px solid #7aa2ff;outline-offset:2px}
.walk-pg-mode-ic{font-size:14px;line-height:1}
.walk-pg-pick{position:fixed;top:14px;right:192px;z-index:3;pointer-events:auto;display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.16);background:rgba(14,16,22,.72);color:#f2f4f8;font:600 12.5px/1 system-ui,sans-serif;padding:9px 13px;border-radius:999px;cursor:pointer;backdrop-filter:blur(6px);transition:background .2s ease,transform .15s ease}
.walk-pg-pick:hover{background:rgba(122,162,255,.55)}
.walk-pg-pick:active{transform:scale(.96)}
.walk-pg-pick:focus-visible{outline:2px solid #7aa2ff;outline-offset:2px}
.walk-pg-pick-ic{font-size:14px;line-height:1}
.walk-pg-hint{position:fixed;left:50%;bottom:22px;transform:translateX(-50%) translateY(8px);z-index:3;pointer-events:none;max-width:88vw;width:max-content;background:rgba(18,20,28,.92);color:#f2f4f8;font:500 13px/1.4 system-ui,sans-serif;padding:9px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.1);box-shadow:0 10px 28px rgba(0,0,0,.35);opacity:0;transition:opacity .3s ease,transform .3s ease;text-align:center}
.walk-pg-hint.is-in{opacity:1;transform:translateX(-50%) translateY(0)}
.walk-pg-btn{pointer-events:auto;border:1px solid rgba(255,255,255,.18);background:rgba(16,18,26,.78);color:#fff;display:grid;place-items:center;backdrop-filter:blur(6px);-webkit-user-select:none;user-select:none;touch-action:none}
.walk-pg-btn:active{background:rgba(122,162,255,.5)}
.walk-pg--stroll .walk-pg-pad{position:fixed;left:18px;bottom:18px;z-index:3;display:none;flex-direction:column;align-items:center;gap:8px;pointer-events:none}
.walk-pg--stroll .walk-pg-pad-row{display:flex;gap:8px;align-items:center}
.walk-pg--stroll .walk-pg-btn{width:54px;height:54px;border-radius:14px;font-size:20px}
.walk-pg-dive{border-radius:50%!important;background:rgba(122,162,255,.32)}
.walk-pg--plat .walk-pg-pad{position:fixed;left:0;right:0;bottom:18px;z-index:3;display:none;justify-content:center;gap:12px;pointer-events:none}
.walk-pg--plat .walk-pg-btn{width:60px;height:60px;border-radius:50%;font-size:22px}
.walk-pg-jump{background:rgba(122,162,255,.32)}
.walk-pg-emotes{position:fixed;right:14px;top:50%;transform:translateY(-50%);z-index:3;display:flex;flex-direction:column;gap:10px;pointer-events:none}
.walk-pg-emote{pointer-events:auto;width:54px;height:54px;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:rgba(16,18,26,.78);color:#fff;font-size:24px;line-height:1;display:grid;place-items:center;cursor:pointer;backdrop-filter:blur(6px);transition:background .2s ease,transform .15s ease;-webkit-user-select:none;user-select:none;touch-action:manipulation;padding:0}
.walk-pg-emote:hover{background:rgba(122,162,255,.55);transform:scale(1.06)}
.walk-pg-emote:active{transform:scale(.92)}
.walk-pg-emote:focus-visible{outline:2px solid #7aa2ff;outline-offset:2px}
.walk-pg-emote.is-playing{animation:walk-pg-emote-pop .45s ease}
@keyframes walk-pg-emote-pop{0%{transform:scale(1)}40%{transform:scale(1.22)}100%{transform:scale(1)}}
@media (max-width:520px){.walk-pg-emotes{right:10px;gap:8px}.walk-pg-emote{width:46px;height:46px;font-size:20px}}
.walk-pg-flash{position:fixed;inset:0;z-index:2;pointer-events:none;background:radial-gradient(circle at 50% 50%,rgba(122,162,255,0) 0%,rgba(8,10,16,0) 60%);opacity:0;transition:opacity .5s ease}
.walk-pg-flash.is-on{background:radial-gradient(circle at 50% 50%,rgba(122,162,255,.25) 0%,rgba(6,8,14,.96) 70%);opacity:1}
.walk-pg-portal{outline:2px solid rgba(122,162,255,.9)!important;outline-offset:3px;border-radius:6px;box-shadow:0 0 0 4px rgba(122,162,255,.18),0 0 28px rgba(122,162,255,.45)!important;transition:box-shadow .2s ease,transform .25s ease;animation:walk-pg-pulse 1.1s ease-in-out infinite}
.walk-pg-portal.is-open{transform:scale(.94);box-shadow:0 0 0 6px rgba(122,162,255,.3),0 0 48px rgba(122,162,255,.7)!important}
@keyframes walk-pg-pulse{0%,100%{box-shadow:0 0 0 4px rgba(122,162,255,.16),0 0 22px rgba(122,162,255,.35)}50%{box-shadow:0 0 0 6px rgba(122,162,255,.3),0 0 36px rgba(122,162,255,.6)}}
@media (pointer: coarse){.walk-pg--stroll .walk-pg-pad,.walk-pg--plat .walk-pg-pad{display:flex}.walk-pg--stroll .walk-pg-hint{bottom:200px}.walk-pg--plat .walk-pg-hint{bottom:110px}.walk-pg-mode .walk-pg-mode-tx{display:none}.walk-pg-mode{right:84px}.walk-pg-pick .walk-pg-pick-tx{display:none}.walk-pg-pick{right:132px}}
@media (prefers-reduced-motion:reduce){.walk-pg,.walk-pg-hint,.walk-pg-flash{transition:none}.walk-pg-portal,.walk-pg-emote.is-playing{animation:none}}
`,document.head.appendChild(i)}function Ig(i){return i==="platformer"?Xu:qu}function sc(i={}){if(i.config&&(xt=i.config),qe)return qe;let e=i.mode||yg();return qe=new(Ig(e)),qe.mount({...i,mode:e}),qe}function wi(){qe&&(qe.unmount(),qe=null);try{window.dispatchEvent(new CustomEvent("walk-playground:exit"))}catch{}}function Vi(i=null){if(!qe||!qe.mounted)return null;let e=qe.mode,t=i||(e==="platformer"?"stroll":"platformer");if(t===e)return qe;FM(t);let n=qe.currentScreenPos(),s=qe._avatarId||null,r=qe._checkpoints?{checkpoints:qe._checkpoints,onReach:qe._onReach,onComplete:qe._onComplete,startCheckpoint:qe._activeCp}:null;qe.unmount(),qe=new(Ig(t)),qe.mount({avatarId:s,startScreen:n,switched:!0,mode:t,...r});try{window.dispatchEvent(new CustomEvent("walk-playground:mode",{detail:{mode:t}}))}catch{}return qe}function Ta(){return qe?.mode||yg()}function kg(){if(!qe||!qe.mounted)return null;let i=qe.char,e={mode:qe.mode,x:Math.round(i.x),y:Math.round(i.y),vx:Math.round(i.vx),vy:Math.round(i.vy),diving:qe._diving};return qe._checkpoints&&(e.quest={checkpoint:qe._activeCp,total:qe._checkpoints.length,narrating:qe._narrating}),qe.mode==="platformer"?{...e,grounded:i.grounded,facing:i.facing,platforms:qe.platforms.length,onLink:!!qe.platform?.href}:{...e,speed:Math.round(Math.hypot(i.vx,i.vy)),onLink:!!qe._armHref}}var xt,ag,og,lg,wM,MM,jt,cg,SM,AM,Wu,EM,hg,ug,TM,RM,CM,LM,PM,tc,IM,kM,dg,Sg,nc,qu,Xu,pg,qe,Dg=rt(()=>{"use strict";at();jh();Cl();kl();$l();Ql();ec();xt=Gi(),ag=150,og=3600,lg=360,wM=250,MM=3200,jt=30,cg=.5,SM=1100,AM=90,Wu=138,EM=2600,hg=2400,ug=330,TM=250,RM=1e3,CM=2600,LM=1400,PM=2400,tc=26,IM=14,kM=["a[href]","button","h1","h2","h3","h4","p","li","img","figure",".card","[data-platform]"].join(","),dg=!1;Sg=[{name:"dance",icon:"\u{1F57A}",label:"Dance",key:"1"},{name:"punch",icon:"\u{1F44A}",label:"Punch",key:"2"},{name:"backflip",icon:"\u{1F938}",label:"Backflip",key:"3"},{name:"wave",icon:"\u{1F44B}",label:"Wave",key:"4"}];nc=.45;qu=class{constructor(){this.mode="stroll",this.mounted=!1,this._reduced=Pl(),this._raf=0,this._diveTimer=0,this._hintTimer=0,this._tick=this._tick.bind(this),this._onKeyDown=this._onKeyDown.bind(this),this._onKeyUp=this._onKeyUp.bind(this),this._onResize=this._onResize.bind(this),this._onVisibility=this._onVisibility.bind(this),this.char={x:0,y:0,vx:0,vy:0,facing:0},this._yaw=0,this.input={up:!1,down:!1,left:!1,right:!1,dive:!1},this._padHeld={},this._armEl=null,this._armHref=null,this._lastProbe=0,this._diving=!1,this._spawnGuardUntil=0,this._v0=new L,this._v1=new L,this._picker=null,this.model=null,this._charPx=ag}async mount({avatarId:e=null,startScreen:t=null,dropIn:n=!1,switched:s=!1,checkpoints:r=null,onReach:a=null,onComplete:o=null,startCheckpoint:l=0}={}){if(!this.mounted){if(!Il()){zn.warn("playground: WebGL unavailable");return}this.mounted=!0,this._avatarId=e,mg(this,{checkpoints:r,onReach:a,onComplete:o,startCheckpoint:l}),this._buildDom();try{await this._buildScene()}catch(c){zn.warn("playground failed to load avatar:",c?.message||c),this._teardown();return}if(!this.mounted){this._teardown();return}Yu(this),this._placeStart(t,n),gg(this),this._spawnGuardUntil=performance.now()+SM,this._bindEvents(),s?this._sayModeIntro():this._hintFor(n),this.clock=new Oi,this._raf=requestAnimationFrame(this._tick)}}setNarrating(e){this._narrating=!!e}unmount(){this.mounted&&(this.mounted=!1,cancelAnimationFrame(this._raf),this._raf=0,clearTimeout(this._diveTimer),clearTimeout(this._hintTimer),window.removeEventListener("keydown",this._onKeyDown,!0),window.removeEventListener("keyup",this._onKeyUp,!0),window.removeEventListener("resize",this._onResize),document.removeEventListener("visibilitychange",this._onVisibility),this._clearArm(),Tg(this),xg(this),this._teardown())}_onVisibility(){document.hidden?(cancelAnimationFrame(this._raf),this._raf=0):this.mounted&&!this._raf&&(this._raf=requestAnimationFrame(this._tick))}currentScreenPos(){return{x:this.char.x-(window.scrollX||0),y:this.char.y-(window.scrollY||0)}}_buildDom(){Pg();let e=document.createElement("div");e.className="walk-pg walk-pg--stroll",this._checkpoints&&e.classList.add("is-quest"),e.setAttribute("role","application"),e.setAttribute("aria-label","Page playground \u2014 walk the character with the arrow keys"),e.innerHTML=`
			<canvas class="walk-pg-canvas"></canvas>
			<div class="walk-pg-hint" aria-live="polite"></div>
			${xt.enablePicker===!1?"":Mg()}
			${wg(this.mode)}
			<button type="button" class="walk-pg-exit" aria-label="Exit playground" title="Exit (Esc)">Exit \u2715</button>
			<div class="walk-pg-pad" aria-hidden="true">
				<button type="button" class="walk-pg-btn" data-act="up" aria-label="Walk up">\u25B2</button>
				<div class="walk-pg-pad-row">
					<button type="button" class="walk-pg-btn" data-act="left" aria-label="Walk left">\u25C0</button>
					<button type="button" class="walk-pg-btn walk-pg-dive" data-act="dive" aria-label="Dive into link">\u2B07</button>
					<button type="button" class="walk-pg-btn" data-act="right" aria-label="Walk right">\u25B6</button>
				</div>
				<button type="button" class="walk-pg-btn" data-act="down" aria-label="Walk down">\u25BC</button>
			</div>
			<div class="walk-pg-flash" aria-hidden="true"></div>
		`,document.body.appendChild(e),this.host=e,this.canvas=e.querySelector(".walk-pg-canvas"),this.hintEl=e.querySelector(".walk-pg-hint"),this.flashEl=e.querySelector(".walk-pg-flash"),e.querySelector(".walk-pg-exit").addEventListener("click",()=>wi()),e.querySelector(".walk-pg-mode").addEventListener("click",()=>Vi()),e.querySelector(".walk-pg-pick")?.addEventListener("click",t=>{t.stopPropagation(),ic(this)}),e.querySelectorAll(".walk-pg-btn").forEach(t=>{let n=t.getAttribute("data-act"),s=a=>{a.preventDefault(),this._setAct(n,!0)},r=a=>{a.preventDefault(),this._setAct(n,!1)};t.addEventListener("pointerdown",s),t.addEventListener("pointerup",r),t.addEventListener("pointerleave",r),t.addEventListener("pointercancel",r)}),requestAnimationFrame(()=>e.classList.add("is-in"))}_setAct(e,t){e in this.input&&(this.input[e]=t)}async _buildScene(){let e=new gs({canvas:this.canvas,alpha:!0,antialias:!0});e.setPixelRatio(Math.min(window.devicePixelRatio,2)),this.renderer=e,Rl(),this._resizeRenderer();let t=new Ii;this.scene=t,t.add(new Ui(16777215,.9));let n=new Fi(12375807,1712688,.75);n.position.set(0,300,0),t.add(n);let s=new Jn(16777215,1.7);s.position.set(80,320,260),t.add(s),this._setupCamera();let r=new Pt;t.add(r),this.rig=r;let a=new Bt(new Kr(1,28),new Sn({color:329484,transparent:!0,opacity:.32,side:on,depthWrite:!1}));a.renderOrder=-1,t.add(a),this.shadow=a;let{model:o,controller:l,halfW:c}=await Ku(this._avatarId,ag);this.modelHalfW=c,this._shadowR=Math.max(22,c*1.15),r.add(o),this.model=o,this.controller=l}_setupCamera(){let e=window.innerWidth,t=window.innerHeight,n=new Kn(-e/2,e/2,t/2,-t/2,-4e3,8e3),s=3e3;n.position.set(0,Math.sin(cg)*s,Math.cos(cg)*s),n.up.set(0,1,0),n.lookAt(0,0,0),n.updateProjectionMatrix(),n.updateMatrixWorld(!0),this.camera=n}_pagePointAtScreen(e,t,n){let s=window.innerWidth,r=window.innerHeight,a=e/s*2-1,o=-(t/r*2-1),l=this._v0.set(a,o,-1).unproject(this.camera),c=this._v1.set(a,o,1).unproject(this.camera),h=c.z-l.z,u=Math.abs(h)<1e-6?0:-l.z/h;return n.set(l.x+(c.x-l.x)*u,l.y+(c.y-l.y)*u,0)}_placeStart(e,t){let n=window.scrollX||0,s=window.scrollY||0,r=si();e?(this.char.x=zt(e.x+n,jt,r-jt),this.char.y=zt(e.y+s,jt,ys()-jt)):(this.char.x=zt(r*.5,jt,r-jt),this.char.y=zt(s+window.innerHeight*(t?.32:.4),jt,ys()-jt)),this.char.vx=0,this.char.vy=0,this._dropIn=t}_bindEvents(){window.addEventListener("keydown",this._onKeyDown,!0),window.addEventListener("keyup",this._onKeyUp,!0),window.addEventListener("resize",this._onResize),document.addEventListener("visibilitychange",this._onVisibility)}_onKeyDown(e){let t=e.key;if(this._picker?.isOpen())return;if(t==="Escape"){wi();return}if(t==="m"||t==="M"){e.preventDefault(),Vi();return}if(t==="c"||t==="C"){e.preventDefault(),ic(this);return}if(Eg(this,t)){e.preventDefault();return}let n=!0;t==="ArrowLeft"||t==="a"||t==="A"?this.input.left=!0:t==="ArrowRight"||t==="d"||t==="D"?this.input.right=!0:t==="ArrowUp"||t==="w"||t==="W"?this.input.up=!0:t==="ArrowDown"||t==="s"||t==="S"?this.input.down=!0:t===" "||t==="Spacebar"||t==="Enter"||t==="e"||t==="E"?this.input.dive=!0:n=!1,n&&e.preventDefault()}_onKeyUp(e){let t=e.key;t==="ArrowLeft"||t==="a"||t==="A"?this.input.left=!1:t==="ArrowRight"||t==="d"||t==="D"?this.input.right=!1:t==="ArrowUp"||t==="w"||t==="W"?this.input.up=!1:t==="ArrowDown"||t==="s"||t==="S"?this.input.down=!1:(t===" "||t==="Spacebar"||t==="Enter"||t==="e"||t==="E")&&(this.input.dive=!1)}_onResize(){this._resizeRenderer(),this._setupCamera(),this.char.x=zt(this.char.x,jt,si()-jt),this.char.y=zt(this.char.y,jt,ys()-jt)}_resizeRenderer(){this.renderer.setSize(window.innerWidth,window.innerHeight,!1)}_hintFor(e){let n=matchMedia("(pointer: coarse)").matches?"Use the d-pad to walk":"Arrow keys / WASD to walk anywhere";if(this._checkpoints){this._say(`${n} \u2014 reach the glowing checkpoint.`,5200);return}this._say(e?`You're in! ${n}. Step on a link to dive deeper.`:`${n}. Step on a link to dive in.`,5200)}_sayModeIntro(){this._say("Stroll mode \u2014 free roam, no falling. M to switch back.",3800)}_say(e,t=3200){!this.hintEl||!e||(this.hintEl.textContent=e,this.hintEl.classList.add("is-in"),clearTimeout(this._hintTimer),this._hintTimer=setTimeout(()=>this.hintEl?.classList.remove("is-in"),t))}_armLink(e,t){this._armEl!==e&&(this._clearArm(),this._armEl=e,this._armHref=t,e.classList.add("walk-pg-portal"),this._say("Press Space (or \u2B07 / gamepad) to dive in",2400))}_clearArm(){this._armEl&&this._armEl.classList.remove("walk-pg-portal"),this._armEl=null,this._armHref=null}_dive(e){if(this._diving||!e)return;this._diving=!0,this.controller?.setState("jump"),this._armEl&&this._armEl.classList.add("is-open"),Ll(xt.keys.resume,"1"),this.flashEl?.classList.add("is-on");let t=()=>{location.href=e};if(this._reduced){t();return}this.char.vx=0,this.char.vy=0,this._diveTimer=setTimeout(t,560)}_tick(){if(!this.mounted)return;this.clock.update();let e=Math.min(this.clock.getDelta(),.033);this._diving||this._step(e),this._follow(),this._render(e),this._checkpoints&&ju(this),this._raf=requestAnimationFrame(this._tick)}_pollGamepad(){let e=Rg();Cg(this.input,this._padHeld,{up:!!e?.up,down:!!e?.down,left:!!e?.left,right:!!e?.right,dive:!!(e?.faceA||e?.faceB)})}_step(e){this._pollGamepad();let t=this.char,n=(this.input.right?1:0)-(this.input.left?1:0),s=(this.input.down?1:0)-(this.input.up?1:0);if(this._narrating&&(n=0,s=0),n!==0&&s!==0){let l=1/Math.SQRT2;n*=l,s*=l}if(n!==0||s!==0){t.vx+=n*og*e,t.vy+=s*og*e;let l=Math.hypot(t.vx,t.vy);if(l>lg){let c=lg/l;t.vx*=c,t.vy*=c}}else{let l=MM*e,c=Math.hypot(t.vx,t.vy);if(c<=l)t.vx=0,t.vy=0;else{let h=(c-l)/c;t.vx*=h,t.vy*=h}}t.x=zt(t.x+t.vx*e,jt,si()-jt),t.y=zt(t.y+t.vy*e,jt,ys()-jt);let r=Math.hypot(t.vx,t.vy);r>12&&(this.char.facing=Math.atan2(t.vx,t.vy));let a=performance.now();if(!this._checkpoints&&a-this._lastProbe>AM){this._lastProbe=a;let l=t.x-(window.scrollX||0),c=t.y-(window.scrollY||0),h=UM(l,c);h?this._armLink(h.el,h.href):this._armEl&&this._clearArm()}if(!this._checkpoints&&this._armHref&&this.input.dive&&a>this._spawnGuardUntil){this._dive(this._armHref);return}let o="idle";r>wM?o="run":r>12&&(o="walk"),this.controller?.setState(o),this._checkpoints&&!this._narrating&&bg(this)}_follow(){let e=window.innerHeight,t=window.scrollY||0,n=this.char.y-t,s=e*.3,r=e*.7,a=t;n<s?a=this.char.y-s:n>r&&(a=this.char.y-r),a=zt(a,0,vg()),Math.abs(a-t)>.5&&window.scrollTo(0,a)}_render(e){let t=this.char,n=t.x-(window.scrollX||0),s=t.y-(window.scrollY||0);if(this._pagePointAtScreen(n,s,this._v0),this.rig.position.copy(this._v0),this.shadow&&(this.shadow.position.set(this._v0.x,this._v0.y,this._v0.z+.5),this.shadow.scale.set(this._shadowR,this._shadowR*.5,1)),this._diving){this.rig.rotation.y+=e*10;let r=Math.max(.04,this.rig.scale.x-e*1.6);this.rig.scale.setScalar(r),this.shadow&&(this.shadow.material.opacity=Math.max(0,this.shadow.material.opacity-e*.8))}else{let r=this.char.facing-this._yaw;for(;r>Math.PI;)r-=Math.PI*2;for(;r<-Math.PI;)r+=Math.PI*2;this._yaw+=r*Math.min(1,e*11),this.rig.rotation.y=this._yaw}this.controller?.update(e),this.renderer.render(this.scene,this.camera)}_teardown(){Lg(this)}},Xu=class{constructor(){this.mode="platformer",this.mounted=!1,this._reduced=Pl(),this._raf=0,this._diveTimer=0,this._hintTimer=0,this._tick=this._tick.bind(this),this._onKeyDown=this._onKeyDown.bind(this),this._onKeyUp=this._onKeyUp.bind(this),this._onResize=this._onResize.bind(this),this._onVisibility=this._onVisibility.bind(this),this._scheduleRescan=this._scheduleRescan.bind(this),this.char={x:0,y:0,vx:0,vy:0,grounded:!1,facing:1},this.platform=null,this.platforms=[],this._lastScan=0,this._scrollY=0,this.input={left:!1,right:!1,jump:!1,down:!1},this._padHeld={},this._jumpEdge=!1,this._armEl=null,this._armHref=null,this._diving=!1,this._picker=null,this.model=null,this._charPx=Wu}async mount({avatarId:e=null,startScreen:t=null,dropIn:n=!1,switched:s=!1,checkpoints:r=null,onReach:a=null,onComplete:o=null,startCheckpoint:l=0}={}){if(!this.mounted){if(!Il()){zn.warn("playground: WebGL unavailable");return}this.mounted=!0,this._avatarId=e,mg(this,{checkpoints:r,onReach:a,onComplete:o,startCheckpoint:l}),this._buildDom();try{await this._buildScene()}catch(c){zn.warn("playground failed to load avatar:",c?.message||c),this._teardown();return}if(!this.mounted){this._teardown();return}Yu(this),this._scrollY=window.scrollY||0,this._scan(!0),this._placeStart(t,n),gg(this),this._spawnGuardUntil=performance.now()+1500,this._bindEvents(),s?this._sayModeIntro():this._hintFor(n),this.clock=new Oi,this._raf=requestAnimationFrame(this._tick)}}setNarrating(e){this._narrating=!!e}unmount(){this.mounted&&(this.mounted=!1,cancelAnimationFrame(this._raf),this._raf=0,clearTimeout(this._diveTimer),clearTimeout(this._hintTimer),window.removeEventListener("keydown",this._onKeyDown,!0),window.removeEventListener("keyup",this._onKeyUp,!0),window.removeEventListener("resize",this._onResize),window.removeEventListener("scroll",this._scheduleRescan,!0),document.removeEventListener("visibilitychange",this._onVisibility),this._clearArm(),Tg(this),xg(this),this._teardown())}_onVisibility(){document.hidden?(cancelAnimationFrame(this._raf),this._raf=0):this.mounted&&!this._raf&&(this._raf=requestAnimationFrame(this._tick))}currentScreenPos(){return{x:this.char.x-(window.scrollX||0),y:this.char.y-(window.scrollY||0)}}_buildDom(){Pg();let e=document.createElement("div");e.className="walk-pg walk-pg--plat",this._checkpoints&&e.classList.add("is-quest"),e.setAttribute("role","application"),e.setAttribute("aria-label","Page playground \u2014 walk and jump the character with arrow keys"),e.innerHTML=`
			<canvas class="walk-pg-canvas"></canvas>
			<div class="walk-pg-hint" aria-live="polite"></div>
			${xt.enablePicker===!1?"":Mg()}
			${wg(this.mode)}
			<button type="button" class="walk-pg-exit" aria-label="Exit playground" title="Exit (Esc)">Exit \u2715</button>
			<div class="walk-pg-pad" aria-hidden="true">
				<button type="button" class="walk-pg-btn" data-act="left" aria-label="Walk left">\u25C0</button>
				<button type="button" class="walk-pg-btn" data-act="right" aria-label="Walk right">\u25B6</button>
				<button type="button" class="walk-pg-btn walk-pg-jump" data-act="jump" aria-label="Jump">\u2912</button>
				<button type="button" class="walk-pg-btn" data-act="down" aria-label="Dive into link">\u2913</button>
			</div>
			<div class="walk-pg-flash" aria-hidden="true"></div>
		`,document.body.appendChild(e),this.host=e,this.canvas=e.querySelector(".walk-pg-canvas"),this.hintEl=e.querySelector(".walk-pg-hint"),this.flashEl=e.querySelector(".walk-pg-flash"),e.querySelector(".walk-pg-exit").addEventListener("click",()=>wi()),e.querySelector(".walk-pg-mode").addEventListener("click",()=>Vi()),e.querySelector(".walk-pg-pick")?.addEventListener("click",t=>{t.stopPropagation(),ic(this)}),e.querySelectorAll(".walk-pg-btn").forEach(t=>{let n=t.getAttribute("data-act"),s=a=>{a.preventDefault(),this._setAct(n,!0)},r=a=>{a.preventDefault(),this._setAct(n,!1)};t.addEventListener("pointerdown",s),t.addEventListener("pointerup",r),t.addEventListener("pointerleave",r),t.addEventListener("pointercancel",r)}),requestAnimationFrame(()=>e.classList.add("is-in"))}_setAct(e,t){e==="left"?this.input.left=t:e==="right"?this.input.right=t:e==="jump"?(this.input.jump=t,t||(this._jumpEdge=!1)):e==="down"&&(this.input.down=t)}async _buildScene(){let e=new gs({canvas:this.canvas,alpha:!0,antialias:!0});e.setPixelRatio(Math.min(window.devicePixelRatio,2)),this.renderer=e,Rl(),this._resizeRenderer();let t=new Ii;this.scene=t,t.add(new Ui(16777215,.9));let n=new Fi(12375807,1712688,.75);n.position.set(0,200,0),t.add(n);let s=new Jn(16777215,1.7);s.position.set(120,260,220),t.add(s),this.camera=new Kn(0,window.innerWidth,0,-window.innerHeight,-1e3,2e3),this.camera.position.z=600;let r=new Pt;t.add(r),this.rig=r;let{model:a,controller:o,halfW:l}=await Ku(this._avatarId,Wu);this.modelHalfW=l,r.add(a),this.model=a,this.controller=o}_placeStart(e,t){let n=window.scrollY||0;t?(this.char.x=zt(si()*.5,40,si()-40),this.char.y=n-Wu,this.char.vy=60,this.char.grounded=!1):e?(this.char.x=zt(e.x+(window.scrollX||0),40,si()-40),this.char.y=e.y+n,this.char.vy=40,this.char.grounded=!1):(this.char.x=zt(si()*.5,40,si()-40),this.char.y=n+window.innerHeight*.3,this.char.vy=0)}_scan(e=!1){let t=performance.now();if(!e&&t-this._lastScan<180)return;this._lastScan=t;let n=window.scrollX||0,s=window.scrollY||0,r=s-1100,a=s+window.innerHeight+1100,o=[],l=new Set,c=document.querySelectorAll(kM);for(let u of c){if(o.length>=360)break;if(this.host.contains(u))continue;let d=u.getBoundingClientRect();if(d.width<38||d.height<14||d.height>520)continue;let f=d.top+s,m=d.bottom+s;if(m<r||f>a)continue;let b=u.ownerDocument.defaultView.getComputedStyle(u);if(b.visibility==="hidden"||b.display==="none"||+b.opacity==0)continue;let g=d.left+n,p=d.right+n,x=`${Math.round(g)},${Math.round(f)},${Math.round(p)}`;if(l.has(x))continue;l.add(x);let w=u.closest("a[href]"),y=null;if(w){let S=w.getAttribute("href")||"";if(S&&!S.startsWith("#")&&(!w.target||w.target==="_self"))try{let E=new URL(S,location.href);E.origin===location.origin&&(y=E.href)}catch{}}o.push({left:g,right:p,top:f,bottom:m,href:y,el:u})}let h=si();o.push({left:-40,right:h+40,top:ys()-3,bottom:ys(),href:null,el:null}),this.platforms=o,this.platform&&!o.includes(this.platform)&&o.push(this.platform)}_scheduleRescan(){this._scrollY=window.scrollY||0,this._scan()}_bindEvents(){window.addEventListener("keydown",this._onKeyDown,!0),window.addEventListener("keyup",this._onKeyUp,!0),window.addEventListener("resize",this._onResize),window.addEventListener("scroll",this._scheduleRescan,!0),document.addEventListener("visibilitychange",this._onVisibility)}_onKeyDown(e){let t=e.key;if(this._picker?.isOpen())return;if(t==="Escape"){wi();return}if(t==="m"||t==="M"){e.preventDefault(),Vi();return}if(t==="c"||t==="C"){e.preventDefault(),ic(this);return}if(Eg(this,t)){e.preventDefault();return}let n=!0;t==="ArrowLeft"||t==="a"||t==="A"?this.input.left=!0:t==="ArrowRight"||t==="d"||t==="D"?this.input.right=!0:t===" "||t==="ArrowUp"||t==="w"||t==="W"||t==="Spacebar"?this.input.jump=!0:t==="ArrowDown"||t==="s"||t==="S"?this.input.down=!0:n=!1,n&&e.preventDefault()}_onKeyUp(e){let t=e.key;t==="ArrowLeft"||t==="a"||t==="A"?this.input.left=!1:t==="ArrowRight"||t==="d"||t==="D"?this.input.right=!1:t===" "||t==="ArrowUp"||t==="w"||t==="W"||t==="Spacebar"?(this.input.jump=!1,this._jumpEdge=!1):(t==="ArrowDown"||t==="s"||t==="S")&&(this.input.down=!1)}_onResize(){this._resizeRenderer(),this.camera&&(this.camera.right=window.innerWidth,this.camera.bottom=-window.innerHeight,this.camera.updateProjectionMatrix()),this._scan(!0)}_resizeRenderer(){this.renderer.setSize(window.innerWidth,window.innerHeight,!1)}_hintFor(e){let n=matchMedia("(pointer: coarse)").matches?"Use the buttons":"Arrow keys / WASD to move, Space to jump";if(this._checkpoints){this._say(`${n} \u2014 reach the glowing checkpoint.`,5200);return}this._say(e?`You fell in! ${n}. Land on a link to dive deeper.`:`${n}. Land on a link to dive in.`,5200)}_sayModeIntro(){let t=matchMedia("(pointer: coarse)").matches?"tap \u2912 to jump":"Space to jump";this._say(`Platformer mode \u2014 gravity on, ${t}. M to switch back.`,3800)}_say(e,t=3200){!this.hintEl||!e||(this.hintEl.textContent=e,this.hintEl.classList.add("is-in"),clearTimeout(this._hintTimer),this._hintTimer=setTimeout(()=>this.hintEl?.classList.remove("is-in"),t))}_armLink(e){this._armEl!==e.el&&(this._clearArm(),this._armEl=e.el,this._armHref=e.href,e.el.classList.add("walk-pg-portal"),this._say("Press \u2193 (or \u2913 / gamepad) to dive in",2200))}_clearArm(){this._armEl&&this._armEl.classList.remove("walk-pg-portal"),this._armEl=null,this._armHref=null}_dive(e){if(this._diving||!e)return;this._diving=!0,this.controller?.setState("jump"),this._armEl&&this._armEl.classList.add("is-open"),Ll(xt.keys.resume,"1"),this.flashEl?.classList.add("is-on");let t=()=>{location.href=e};if(this._reduced){t();return}this.char.vx=0,this.char.vy=hg,this.char.grounded=!1,this._diveTimer=setTimeout(t,620)}_tick(){if(!this.mounted)return;this.clock.update();let e=Math.min(this.clock.getDelta(),.033);this._diving||this._step(e),this._follow(e),this._render(e),this._checkpoints&&ju(this),this._raf=requestAnimationFrame(this._tick)}_pollGamepad(){let e=Rg();Cg(this.input,this._padHeld,{left:!!e?.left,right:!!e?.right,jump:!!e?.faceA,down:!!(e?.down||e?.faceB)})}_step(e){this._pollGamepad();let t=this.char,n=this._narrating,s=n?0:(this.input.right?1:0)-(this.input.left?1:0),r=t.grounded?CM:LM;if(s!==0)t.vx+=s*r*e,t.vx=zt(t.vx,-ug,ug),t.facing=s;else if(t.grounded){let c=PM*e;Math.abs(t.vx)<=c?t.vx=0:t.vx-=Math.sign(t.vx)*c}if(this.input.jump||(this._jumpEdge=!1),this.input.jump&&t.grounded&&!this._jumpEdge&&!n&&(t.vy=-RM,t.grounded=!1,this.platform=null,this._jumpEdge=!0,this._clearArm()),this.input.down&&t.grounded&&!n)if(this.platform?.href&&!this._checkpoints){if(performance.now()>this._spawnGuardUntil){this._dive(this.platform.href);return}}else{t.y+=4,t.grounded=!1;let c=this.platform;this.platform=null,this._dropIgnore=c}t.vy=Math.min(t.vy+EM*e,hg);let a=t.y;if(t.x=zt(t.x+t.vx*e,this.modelHalfW,si()-this.modelHalfW),t.y=t.y+t.vy*e,t.vy>=0){let c=null;for(let h of this.platforms)h!==this._dropIgnore&&(t.x<h.left-tc||t.x>h.right+tc||a<=h.top+IM&&t.y>=h.top&&(!c||h.top<c.top)&&(c=h));if(c)t.y=c.top,t.vy=0,t.grounded=!0,this.platform=c,this._dropIgnore=null;else if(t.grounded&&this.platform){let h=this.platform;t.x<h.left-tc||t.x>h.right+tc?(t.grounded=!1,this.platform=null):t.y=h.top}else t.grounded=!1}let o=performance.now()>this._spawnGuardUntil;!this._checkpoints&&o&&t.grounded&&this.platform?.href&&Math.abs(t.vx)<30&&s===0?this._armLink(this.platform):this._armEl&&(!t.grounded||this.platform?.el!==this._armEl||s!==0)&&this._clearArm();let l="idle";t.grounded?Math.abs(t.vx)>TM?l="run":Math.abs(t.vx)>6&&(l="walk"):l="jump",this.controller?.setState(l),this._checkpoints&&!this._narrating&&t.grounded&&bg(this)}_follow(e){let t=zt(this.char.y-window.innerHeight*.55,0,vg()),n=window.scrollY||0,s=this._reduced?t:n+(t-n)*Math.min(1,e*6);Math.abs(s-n)>.5&&window.scrollTo(0,s),this._scrollY=window.scrollY||0,this._scan()}_render(e){let t=this.char,n=window.scrollX||0,s=window.scrollY||0,r=t.x-n,a=t.y-s;if(this.rig.position.set(r,-a,0),this._diving){this.rig.rotation.y+=e*9;let o=Math.max(.05,this.rig.scale.x-e*1.4);this.rig.scale.setScalar(o)}else{let o=t.facing>=0?.6:-.6;this.rig.rotation.y+=(o-this.rig.rotation.y)*Math.min(1,e*10)}this.controller?.update(e),this.renderer.render(this.scene,this.camera)}_teardown(){Lg(this)}};pg=!1;qe=null;typeof window<"u"&&(window.__walkPlayground={launch:sc,exit:wi,switchMode:Vi,mode:Ta,state:kg})});var TS={};La(TS,{DEFAULT_COPY:()=>ka,DEFAULT_VOICES:()=>pc,ExploreMode:()=>Mr,TourDirector:()=>wr,VERSION:()=>SS,buildCurriculum:()=>Yg,buildPlaylist:()=>Ss,createFeatureTour:()=>ed,createTourState:()=>Ms,loadCurriculum:()=>ws,normalizePath:()=>nn,resolveTourConfig:()=>As,sectionTitle:()=>Ia,stopIndexForPath:()=>Pa,trackMeta:()=>fd});var fc=new Map;async function ws(i){let e=i?.curriculum??"/tour/curriculum.json";if(e&&typeof e=="object")return dd(e),e;if(fc.has(e))return fc.get(e);let t=await fetch(e,{cache:"force-cache"});if(!t.ok)throw new Error(`tour curriculum ${t.status}`);let n=await t.json();return dd(n),fc.set(e,n),n}function dd(i){if(!i||!Array.isArray(i.stops)||!i.stops.length)throw new Error("tour curriculum empty")}function nn(i=location.pathname){let e=i.replace(/\/+$/,"");return e===""?"/":e}var a0={active:!1,index:0,track:"full",paused:!1,muted:!1,voice:"nova",speed:1},o0={index:0,track:"full",voice:"nova",speed:1,completed:!1};function Ms(i){let e=i.keys.state,t=i.keys.resume,n={...a0,voice:i.defaultVoice},s={...o0,voice:i.defaultVoice};function r(){try{let u=localStorage.getItem(t);return u?{...s,...JSON.parse(u)}:{...s}}catch{return{...s}}}function a(u){let d={...r(),...u};try{localStorage.setItem(t,JSON.stringify(d))}catch{}return d}function o(){try{let u=sessionStorage.getItem(e);return u?{...n,...JSON.parse(u)}:{...n}}catch{return{...n}}}function l(u){let d={...o(),...u};try{sessionStorage.setItem(e,JSON.stringify(d))}catch{}return d.active&&a({index:d.index,track:d.track,voice:d.voice,speed:d.speed}),d}function c(){try{sessionStorage.removeItem(e)}catch{}}function h(){a({completed:!0,index:0})}return{readState:o,writeState:l,clearState:c,readResume:r,writeResume:a,markCompleted:h}}function Ss(i,e="full"){let t=i.stops.map((s,r)=>r);if(e!=="quick")return t;let n=t.filter(s=>i.stops[s].highlight);return n.length?n:t}function fd(i,e="full"){return(i.tracks||[]).find(t=>t.id===e)||null}function Pa(i,e=location.pathname){let t=nn(e);return i.stops.findIndex(n=>nn(n.path)===t)}function Ia(i,e){return(i.sections||[]).find(t=>t.id===e)?.title||""}var pc=[{id:"nova",name:"Nova"},{id:"alloy",name:"Alloy"},{id:"echo",name:"Echo"},{id:"fable",name:"Fable"},{id:"onyx",name:"Onyx"},{id:"sage",name:"Sage"},{id:"shimmer",name:"Shimmer"}],ka={outro:"And that's the tour. Thanks for walking through it with me \u2014 explore on your own whenever you're ready.",offRoute:"We stepped off the tour \u2014 press play and I\u2019ll take you back to where we were.",completion:{title:"Tour complete \u{1F389}",body:"That's the whole tour. Where to next?",primary:null,restartLabel:"Take it again",closeLabel:"Explore on my own"}};function pd(i){return i!=null&&typeof i=="object"}function l0(i={}){let e={...ka,...i};return e.completion={...ka.completion,...i.completion||{}},e}function As(i={}){let e=i.storagePrefix||"tws:tour",t=i.companion===!1?null:{global:pd(i.companion)&&i.companion.global||"__walkCompanion",changeEvent:pd(i.companion)&&i.companion.changeEvent||"walk-companion:change"};return{curriculum:i.curriculum??"/tour/curriculum.json",ttsEndpoint:i.ttsEndpoint===void 0?null:i.ttsEndpoint,defaultVoice:i.defaultVoice||"nova",voices:Array.isArray(i.voices)&&i.voices.length?i.voices:pc,mode:i.mode==="explore"||i.mode==="platformer"?i.mode:"guided",guideAvatarId:i.guideAvatarId||"realistic-female",assetBase:i.assetBase||"",apiBase:i.apiBase||"",manifestUrl:i.manifestUrl||"/animations/manifest.json",avatarStorageKey:i.avatarStorageKey||"walk:companion:avatar",navigate:typeof i.navigate=="function"?i.navigate:n=>{location.assign(n)},deepLinkParam:i.deepLinkParam||"tour",companion:t,copy:l0(i.copy),keys:{state:`${e}:state`,resume:`${e}:resume`}}}at();jh();Cl();kl();$l();Bu();Ql();ec();Dg();Kl();Ql();$l();ec();var cn=168,gn=240,Nt=16,BM=2147483300,$u=2.7,Zu=4.2,HM=1.5,zM=3.4,GM=$u/HM,FR=Zu/zM,Ju=200,VM=-14,WM=.32,qM=.18,rc=class{constructor(e={}){this.config=Gi({assetBase:e.assetBase||"",apiBase:e.apiBase||"",manifestUrl:e.manifestUrl||"/animations/manifest.json",defaultAvatarId:e.guideAvatarId||"realistic-female"}),this.avatarStorageKey=e.avatarStorageKey||this.config.keys.avatar,this.host=null,this.renderer=null,this.scene=null,this.camera=null,this.rig=null,this.model=null,this.controller=null,this.clock=null,this._raf=0,this._pxPerMeter=0,this._walkPx=Ju,this._runPx=Ju*(Zu/$u),this._yaw=0,this._targetYaw=0,this._walking=!1,this._walkRaf=0,this._reduced=matchMedia("(prefers-reduced-motion: reduce)").matches,this._pos={x:0,y:0},this._groundY=0,this._y=0,this._vy=0,this._tick=this._tick.bind(this)}async mount(){KM(),this._buildDom();try{await this._buildScene(),this.clock=new Oi,this._raf=requestAnimationFrame(this._tick)}catch(t){console.warn("[tour] guide avatar failed to load \u2014 continuing without a rendered body:",t?.message||t),this._headless=!0,this.canvas?.remove()}let e={x:window.innerWidth-cn-Nt,y:window.innerHeight-gn-Nt};this._setPos(e)}_buildDom(){let e=document.createElement("div");e.className="tws-tour-guide",e.setAttribute("role","complementary"),e.setAttribute("aria-label","Tour guide"),e.innerHTML=`
			<div class="tws-tour-guide__bubble" hidden></div>
			<canvas class="tws-tour-guide__canvas" width="${cn}" height="${gn}"></canvas>
		`,document.body.appendChild(e),this.host=e,this.canvas=e.querySelector(".tws-tour-guide__canvas"),this.bubble=e.querySelector(".tws-tour-guide__bubble"),requestAnimationFrame(()=>e.classList.add("is-in"))}async _buildScene(){let e=new gs({canvas:this.canvas,alpha:!0,antialias:!0});e.setPixelRatio(Math.min(window.devicePixelRatio,1.5)),e.setSize(cn,gn,!1),this.renderer=e;let t=new Ii;this.scene=t,t.add(new Ui(16777215,.9));let n=new Fi(12375807,2107440,.7);n.position.set(0,4,0),t.add(n);let s=new Jn(16777215,1.6);s.position.set(2,5,4),t.add(s),this.camera=new Mt(40,cn/gn,.05,100),this.rig=new Pt,t.add(this.rig);let r=jM(this.avatarStorageKey)||this.config.defaultAvatarId,a=vi(r,this.config),o=vi(this.config.defaultAvatarId,this.config),{model:l,controller:c}=await xs(a,{assetBase:this.config.assetBase,apiBase:this.config.apiBase,manifestUrl:this.config.manifestUrl,fallbackEntry:o});this.model=l,this.controller=c,this._frame(l,this.rig,this.camera)}_frame(e,t,n){let s=new bt().setFromObject(e),r=s.getSize(new L),a=s.getCenter(new L);e.position.x-=a.x,e.position.z-=a.z,e.position.y-=s.min.y,t.add(e);let o=Math.max(.6,r.y);n.position.set(0,o*.62,o*2.2),n.lookAt(0,o*.52,0);let c=2*n.position.distanceTo(new L(0,o*.52,0))*Math.tan(n.fov*Math.PI/180/2),h=this.size().h||gn;this._pxPerMeter=c>0?h/c:0,this._pxPerMeter>0&&(this._walkPx=$u*this._pxPerMeter,this._runPx=Zu*this._pxPerMeter),this._y=this._reduced?this._groundY:this._groundY+WM,this._vy=0,t.position.y=this._y}walkTo(e){let t={x:br(e.x,Nt,window.innerWidth-cn-Nt),y:br(e.y,Nt,window.innerHeight-gn-Nt)};cancelAnimationFrame(this._walkRaf),this._walkRaf=0;let n=t.x-this._pos.x,s=t.y-this._pos.y,r=Math.hypot(n,s);if(r<4||this._reduced)return this._setPos(t),this.settle(),Promise.resolve();let a=n/r,o=s/r,l={x:this._pos.x,y:this._pos.y},c=0,h=performance.now();return new Promise(u=>{let d=f=>{let m=Math.min((f-h)/1e3,.05);if(h=f,c=Math.min(r,c+(this._walkPx||Ju)*m),this.place({x:l.x+a*c,y:l.y+o*c}),c>=r){this._walkRaf=0,this.settle(),u();return}this._walkRaf=requestAnimationFrame(d)};this._walkRaf=requestAnimationFrame(d)})}async approach(e){let t=this._spotBeside(e);await this.walkTo(t),this._faceRect(e)}async park(){await this.walkTo({x:window.innerWidth-cn-Nt,y:window.innerHeight-gn-Nt}),this._targetYaw=0}point(){this.controller?.playWave()}setInteractive(e){this.host&&(this.host.style.pointerEvents=e?"auto":"none",this.host.classList.toggle("is-roam",!!e))}size(){let e=this.host?.getBoundingClientRect();return{w:e?.width||cn,h:e?.height||gn}}place(e){let t=this.size(),n=br(e.x,Nt,window.innerWidth-t.w-Nt),s=br(e.y,Nt,window.innerHeight-t.h-Nt),r=n-this._pos.x,a=s-this._pos.y;Math.hypot(r,a)>1&&(this._targetYaw=Math.atan2(r,a)),this.controller?.setState("walk"),this.controller?.setSpeed?.(GM),this._walking=!0,clearTimeout(this._settleTimer),this._settleTimer=setTimeout(()=>this.settle(),180),this._setPos({x:n,y:s})}settle(){clearTimeout(this._settleTimer),this._walking=!1,this._targetYaw=0,this.controller?.setState("idle"),this.controller?.setSpeed?.(1)}_spotBeside(e){let n=e.left+e.width+22,s=e.left-cn-22,r;n+cn<=window.innerWidth-Nt?r=n:s>=Nt?r=s:r=br(e.cx-cn/2,Nt,window.innerWidth-cn-Nt);let a=br(e.cy-gn*.58,Nt,window.innerHeight-gn-Nt);return{x:r,y:a}}_faceRect(e){let t=this._pos.x+cn/2,n=this._pos.y+gn/2;this._targetYaw=Math.atan2(e.cx-t,e.cy-n)}headScreen(){return{x:this._pos.x+cn/2,y:this._pos.y+gn*.18}}say(e){this.bubble&&(this.bubble.textContent=e,this.bubble.hidden=!1,requestAnimationFrame(()=>this.bubble.classList.add("is-in")))}hideBubble(){this.bubble&&(this.bubble.classList.remove("is-in"),setTimeout(()=>{this.bubble&&(this.bubble.hidden=!0)},280))}_setPos(e){this._pos=e,this.host&&(this.host.style.left=e.x+"px",this.host.style.top=e.y+"px")}_tick(){if(!this.host)return;this.clock.update();let e=Math.min(this.clock.getDelta(),.05);this._yaw+=XM(this._targetYaw-this._yaw)*qM,this.rig&&(this.rig.rotation.y=this._yaw,this._vy+=VM*e,this._y+=this._vy*e,this._y<=this._groundY&&(this._y=this._groundY,this._vy<0&&(this._vy=0)),this.rig.position.y=this._y),this.controller?.update(e),this.renderer.render(this.scene,this.camera),this._raf=requestAnimationFrame(this._tick)}dispose(){cancelAnimationFrame(this._raf),cancelAnimationFrame(this._walkRaf),clearTimeout(this._settleTimer),this._raf=0,this._walkRaf=0;try{this.controller?.dispose()}catch{}this.scene&&this.scene.traverse(e=>{e.isMesh&&YM(e)}),this.renderer&&(this.renderer.dispose(),this.renderer.forceContextLoss?.()),this.host?.remove(),this.host=null}};function br(i,e,t){return Math.min(t,Math.max(e,i))}function XM(i){return Math.atan2(Math.sin(i),Math.cos(i))}function jM(i){try{return localStorage.getItem(i)}catch{return null}}function YM(i){i.geometry?.dispose?.(),(Array.isArray(i.material)?i.material:[i.material]).forEach(t=>{if(t){for(let n of Object.values(t))n&&n.isTexture&&n.dispose();t.dispose?.()}})}var Ng=!1;function KM(){if(Ng)return;Ng=!0;let i=document.createElement("style");i.id="tws-tour-guide-style",i.textContent=`
.tws-tour-guide{position:fixed;left:0;top:0;width:${cn}px;height:${gn}px;z-index:${BM};pointer-events:none;opacity:0;transform:translateY(10px);transition:opacity .4s ease,transform .4s ease;-webkit-user-select:none;user-select:none}
.tws-tour-guide.is-in{opacity:1;transform:translateY(0)}
.tws-tour-guide__canvas{position:absolute;inset:0;width:100%;height:100%;filter:drop-shadow(0 16px 20px rgba(0,0,0,.34))}
.tws-tour-guide__bubble{position:absolute;left:50%;bottom:calc(100% - 30px);transform:translateX(-50%) translateY(8px);width:max-content;max-width:320px;background:rgba(18,20,28,.96);color:#f2f4f8;font:500 13px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;padding:10px 13px;border-radius:14px;border:1px solid rgba(122,162,255,.28);box-shadow:0 12px 30px rgba(0,0,0,.4);opacity:0;transition:opacity .3s ease,transform .3s ease;text-align:left}
.tws-tour-guide__bubble.is-in{opacity:1;transform:translateX(-50%) translateY(0)}
.tws-tour-guide__bubble::after{content:'';position:absolute;left:50%;top:100%;transform:translateX(-50%);border:7px solid transparent;border-top-color:rgba(18,20,28,.96)}
@media (max-width:560px){.tws-tour-guide{width:128px;height:182px}.tws-tour-guide__bubble{max-width:230px;font-size:12px}}
@media (prefers-reduced-motion:reduce){.tws-tour-guide,.tws-tour-guide__bubble{transition:opacity .2s ease}}
`,document.head.appendChild(i)}var Fg=!1;function JM(){if(Fg)return;Fg=!0;let i=document.createElement("style");i.id="tws-tour-spotlight-style",i.textContent=`
.tws-tour-spot{position:fixed;z-index:2147483100;border-radius:12px;pointer-events:none;
	box-shadow:0 0 0 9999px rgba(8,10,16,.62),0 0 0 2px rgba(122,162,255,.9),0 0 28px 6px rgba(122,162,255,.55) inset;
	transition:left .45s cubic-bezier(.4,0,.2,1),top .45s cubic-bezier(.4,0,.2,1),width .45s cubic-bezier(.4,0,.2,1),height .45s cubic-bezier(.4,0,.2,1),opacity .3s ease;
	opacity:0}
.tws-tour-spot.is-in{opacity:1}
.tws-tour-spot::after{content:'';position:absolute;inset:-2px;border-radius:14px;border:2px solid rgba(122,162,255,.55);animation:tws-tour-pulse 1.8s ease-in-out infinite}
@keyframes tws-tour-pulse{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.012);opacity:.25}}
@media (prefers-reduced-motion:reduce){.tws-tour-spot{transition:opacity .2s ease}.tws-tour-spot::after{animation:none}}
`,document.head.appendChild(i)}var xr=class{constructor(){JM(),this.el=document.createElement("div"),this.el.className="tws-tour-spot",this.el.setAttribute("aria-hidden","true"),document.body.appendChild(this.el),this.target=null,this._raf=0,this._rect=null,this._track=this._track.bind(this)}async highlight(e){if(this.target=e||null,!e){this.el.classList.remove("is-in"),this._rect=null;return}await $M(e),this._track(),this.el.classList.add("is-in"),this._raf||(this._raf=requestAnimationFrame(this._track))}_track(){this._raf=0;let e=this.target;if(!e||!e.isConnected){this.el.classList.remove("is-in"),this._rect=null;return}let t=e.getBoundingClientRect();if(t.width<1&&t.height<1)this.el.classList.remove("is-in");else{let s=Math.max(0,t.left-8),r=Math.max(0,t.top-8),a=Math.min(window.innerWidth,t.right+8)-s,o=Math.min(window.innerHeight,t.bottom+8)-r;this.el.style.left=s+"px",this.el.style.top=r+"px",this.el.style.width=a+"px",this.el.style.height=o+"px",this.el.classList.add("is-in"),this._rect={left:s,top:r,width:a,height:o,cx:s+a/2,cy:r+o/2}}this._raf=requestAnimationFrame(this._track)}getRect(){return this._rect}clear(){this.target=null,this._rect=null,this.el.classList.remove("is-in")}dispose(){cancelAnimationFrame(this._raf),this.el?.remove()}};function $M(i){return new Promise(e=>{let t=i.getBoundingClientRect();if(t.top>=64&&t.bottom<=window.innerHeight-64){e();return}let s=matchMedia("(prefers-reduced-motion: reduce)").matches;i.scrollIntoView({behavior:s?"auto":"smooth",block:"center",inline:"nearest"}),setTimeout(e,s?0:480)})}var yr=class{constructor(e={}){this.endpoint=e.ttsEndpoint||null,this.audio=null,this._token=0,this._sleepTimer=0,this._sleepResolve=null,this._finishCurrent=null}estimateMs(e,t=1){let n=String(e||"").trim().split(/\s+/).filter(Boolean).length;return Math.max(1600,n/150*6e4+600)/Ug(t)}async speak(e,{muted:t=!1,voice:n="nova",speed:s=1}={}){this.cancel();let r=++this._token,a=Ug(s),o=String(e||"").trim();if(!o)return;if(!this.endpoint||t){await this._sleep(this.estimateMs(o,a),r);return}let l=null;try{let c=await fetch(this.endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:o.slice(0,4096),voice:n,speed:a,format:"mp3"})});if(r!==this._token)return;if(!c.ok)throw new Error(`tts ${c.status}`);let h=await c.blob();if(r!==this._token)return;l=URL.createObjectURL(h);let u=new Audio(l);u.playbackRate=a,this.audio=u,await new Promise(d=>{let f=!1,m=()=>{f||(f=!0,d())};this._finishCurrent=m,u.addEventListener("ended",m),u.addEventListener("error",m),u.play().catch(m)})}catch{if(r!==this._token)return;await this._sleep(this.estimateMs(o),r)}finally{l&&URL.revokeObjectURL(l),r===this._token&&(this.audio=null,this._finishCurrent=null)}}_sleep(e,t){return new Promise(n=>{this._sleepResolve=n,this._sleepTimer=setTimeout(()=>{t===this._token&&n()},e)})}cancel(){this._token++,clearTimeout(this._sleepTimer),this._sleepTimer=0,this._sleepResolve&&(this._sleepResolve(),this._sleepResolve=null);try{this.audio?.pause()}catch{}this._finishCurrent&&this._finishCurrent(),this._finishCurrent=null,this.audio=null}dispose(){this.cancel()}};function Ug(i){let e=Number(i);return Number.isFinite(e)?Math.min(2,Math.max(.5,e)):1}var ac=class{constructor(e){this.handlers=e,QM(),this._build()}_build(){let e=document.createElement("div");e.className="tws-tour-bar",e.setAttribute("role","group"),e.setAttribute("aria-label","Guided tour controls"),e.innerHTML=`
			<button class="tws-tour-btn" data-act="menu" aria-label="Chapters and settings" title="Chapters & settings" aria-haspopup="dialog" aria-expanded="false">\u2630</button>
			<button class="tws-tour-btn" data-act="prev" aria-label="Previous feature" title="Previous">\u23EE</button>
			<button class="tws-tour-btn tws-tour-btn--play" data-act="toggle" aria-label="Pause tour" title="Pause / resume">\u23F8</button>
			<button class="tws-tour-btn" data-act="next" aria-label="Next feature" title="Next">\u23ED</button>
			<div class="tws-tour-meta">
				<div class="tws-tour-meta__top"><span class="tws-tour-chapter"></span><span class="tws-tour-count"></span></div>
				<div class="tws-tour-track" role="slider" aria-label="Tour progress" tabindex="0" aria-valuemin="1" aria-valuemax="1" aria-valuenow="1">
					<div class="tws-tour-track__fill"></div>
				</div>
			</div>
			<button class="tws-tour-btn tws-tour-btn--speed" data-act="speed" aria-label="Playback speed" title="Playback speed">1\xD7</button>
			<button class="tws-tour-btn" data-act="roam" aria-label="Free roam \u2014 drive the guide yourself" title="Free roam" aria-pressed="false">\u{1F9ED}</button>
			<button class="tws-tour-btn" data-act="mute" aria-label="Mute narration" title="Mute / unmute voice">\u{1F50A}</button>
			<button class="tws-tour-btn tws-tour-btn--exit" data-act="exit" aria-label="Exit tour" title="Exit tour">\u2715</button>
		`,document.body.appendChild(e),this.bar=e,this.menuBtn=e.querySelector('[data-act="menu"]'),this.playBtn=e.querySelector('[data-act="toggle"]'),this.muteBtn=e.querySelector('[data-act="mute"]'),this.speedBtn=e.querySelector('[data-act="speed"]'),this.roamBtn=e.querySelector('[data-act="roam"]'),this.chapterEl=e.querySelector(".tws-tour-chapter"),this.countEl=e.querySelector(".tws-tour-count"),this.track=e.querySelector(".tws-tour-track"),this.fill=e.querySelector(".tws-tour-track__fill"),e.addEventListener("click",t=>{let n=t.target.closest("[data-act]")?.dataset.act;n&&(n==="menu"?this.handlers.onMenu?.():n==="prev"?this.handlers.onPrev?.():n==="next"?this.handlers.onNext?.():n==="toggle"?this.handlers.onToggle?.():n==="speed"?this.handlers.onSpeed?.():n==="roam"?this.handlers.onRoam?.():n==="mute"?this.handlers.onMute?.():n==="exit"&&this.handlers.onExit?.())}),this.track.addEventListener("click",t=>this._seekFromEvent(t)),this.track.addEventListener("keydown",t=>{t.key==="ArrowRight"?this.handlers.onNext?.():t.key==="ArrowLeft"&&this.handlers.onPrev?.()}),requestAnimationFrame(()=>e.classList.add("is-in"))}_seekFromEvent(e){let t=this.track.getBoundingClientRect(),n=ZM((e.clientX-t.left)/t.width,0,1),s=this._total||1,r=Math.round(n*(s-1));this.handlers.onSeek?.(r)}update({chapter:e,index:t,total:n}){this._total=n,this.chapterEl.textContent=e||"",this.countEl.textContent=`${t+1} / ${n}`;let s=n>1?t/(n-1):1;this.fill.style.width=(s*100).toFixed(1)+"%",this.track.setAttribute("aria-valuemax",String(n)),this.track.setAttribute("aria-valuenow",String(t+1)),this.track.setAttribute("aria-valuetext",`${e}, feature ${t+1} of ${n}`)}setPaused(e){this.playBtn.textContent=e?"\u25B6":"\u23F8",this.playBtn.setAttribute("aria-label",e?"Resume tour":"Pause tour"),this.bar.classList.toggle("is-paused",e)}setMuted(e){this.muteBtn.textContent=e?"\u{1F507}":"\u{1F50A}",this.muteBtn.setAttribute("aria-label",e?"Unmute narration":"Mute narration")}setSpeed(e){let t=(Number(e)||1).toFixed(2).replace(/\.?0+$/,"");this.speedBtn.textContent=t+"\xD7",this.speedBtn.setAttribute("aria-label",`Playback speed ${t} times \u2014 tap to change`)}setMenuOpen(e){this.menuBtn.setAttribute("aria-expanded",e?"true":"false"),this.menuBtn.classList.toggle("is-active",e)}setRoam(e){this.roamBtn.setAttribute("aria-pressed",e?"true":"false"),this.roamBtn.classList.toggle("is-active",e),this.roamBtn.setAttribute("title",e?"Rejoin the tour":"Free roam"),this.bar.classList.toggle("is-roaming",e)}dispose(){this.bar?.remove(),this.bar=null}};function ZM(i,e,t){return Math.min(t,Math.max(e,i))}var Og=!1;function QM(){if(Og)return;Og=!0;let i=document.createElement("style");i.id="tws-tour-bar-style",i.textContent=`
.tws-tour-bar{position:fixed;left:50%;bottom:18px;transform:translateX(-50%) translateY(14px);z-index:2147483400;display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(14,16,22,.92);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.1);border-radius:16px;box-shadow:0 16px 40px rgba(0,0,0,.45);opacity:0;transition:opacity .35s ease,transform .35s ease;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:min(560px,calc(100vw - 24px))}
.tws-tour-bar.is-in{opacity:1;transform:translateX(-50%) translateY(0)}
.tws-tour-btn{appearance:none;border:none;background:rgba(255,255,255,.06);color:#eef1f6;width:36px;height:36px;border-radius:10px;font-size:15px;line-height:1;cursor:pointer;display:grid;place-items:center;transition:background .18s ease,transform .12s ease}
.tws-tour-btn:hover{background:rgba(122,162,255,.22)}
.tws-tour-btn:active{transform:scale(.92)}
.tws-tour-btn:focus-visible{outline:2px solid #7aa2ff;outline-offset:2px}
.tws-tour-btn--play{background:rgba(122,162,255,.9);color:#0b0e16}
.tws-tour-btn--play:hover{background:rgba(122,162,255,1)}
.tws-tour-btn--speed{width:auto;min-width:40px;padding:0 9px;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}
.tws-tour-btn.is-active{background:rgba(122,162,255,.28);color:#cdd8ff}
.tws-tour-btn--exit:hover{background:rgba(220,70,70,.85)}
.tws-tour-meta{display:flex;flex-direction:column;gap:5px;min-width:160px;flex:1}
.tws-tour-meta__top{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:12px}
.tws-tour-chapter{color:#aeb6c6;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tws-tour-count{color:#7f8aa0;font-variant-numeric:tabular-nums;white-space:nowrap}
.tws-tour-track{position:relative;height:6px;border-radius:99px;background:rgba(255,255,255,.12);cursor:pointer}
.tws-tour-track:focus-visible{outline:2px solid #7aa2ff;outline-offset:3px}
.tws-tour-track__fill{position:absolute;left:0;top:0;height:100%;border-radius:99px;background:linear-gradient(90deg,#7aa2ff,#9d7bff);transition:width .4s ease}
@media (max-width:560px){.tws-tour-meta{min-width:96px}.tws-tour-chapter{max-width:120px}}
@media (prefers-reduced-motion:reduce){.tws-tour-bar,.tws-tour-track__fill{transition:opacity .2s ease}}
`,document.head.appendChild(i)}var eS=[{id:"nova",name:"Nova"},{id:"alloy",name:"Alloy"},{id:"fable",name:"Fable"}],tS=[.75,1,1.25,1.5],oc=class{constructor(e,t,n){this.curriculum=e,this.handlers=t,this.voices=Array.isArray(n)&&n.length?n:eS,this.open=!1,this.activeAbs=0,this._query="",this._onKey=this._onKey.bind(this),sS(),this._build()}_build(){let e=document.createElement("div");e.className="tws-tour-menu",e.innerHTML=`
			<div class="tws-tour-menu__scrim" data-act="close"></div>
			<aside class="tws-tour-menu__panel" role="dialog" aria-modal="false" aria-label="Tour chapters and settings" tabindex="-1">
				<div class="tws-tour-menu__head">
					<div class="tws-tour-menu__title">Tour map</div>
					<button class="tws-tour-menu__x" data-act="close" aria-label="Close menu" title="Close">\u2715</button>
				</div>
				<div class="tws-tour-menu__settings">
					<label class="tws-tour-menu__field">
						<span class="tws-tour-menu__lbl">Track</span>
						<div class="tws-tour-seg" data-group="track" role="radiogroup" aria-label="Tour length"></div>
					</label>
					<label class="tws-tour-menu__field">
						<span class="tws-tour-menu__lbl">Speed</span>
						<div class="tws-tour-seg" data-group="speed" role="radiogroup" aria-label="Playback speed"></div>
					</label>
					<label class="tws-tour-menu__field">
						<span class="tws-tour-menu__lbl" id="tws-tour-voice-lbl">Voice</span>
						<select class="tws-tour-menu__select" data-act="voice" aria-labelledby="tws-tour-voice-lbl"></select>
					</label>
				</div>
				<div class="tws-tour-menu__search">
					<input type="search" class="tws-tour-menu__input" placeholder="Search features\u2026" aria-label="Search tour stops" autocomplete="off" spellcheck="false" />
				</div>
				<nav class="tws-tour-menu__list" aria-label="Tour chapters"></nav>
			</aside>`,document.body.appendChild(e),this.root=e,this.panel=e.querySelector(".tws-tour-menu__panel"),this.listEl=e.querySelector(".tws-tour-menu__list"),this.trackSeg=e.querySelector('[data-group="track"]'),this.speedSeg=e.querySelector('[data-group="speed"]'),this.voiceSel=e.querySelector('[data-act="voice"]'),this.searchInput=e.querySelector(".tws-tour-menu__input"),this._buildSegments(),this._buildVoices(),this._buildList(),e.addEventListener("click",t=>{t.target.closest('[data-act="close"]')&&this.close()}),this.trackSeg.addEventListener("click",t=>{let n=t.target.closest("[data-val]")?.dataset.val;n&&this.handlers.onTrack?.(n)}),this.speedSeg.addEventListener("click",t=>{let n=t.target.closest("[data-val]")?.dataset.val;n&&this.handlers.onSpeed?.(Number(n))}),this.voiceSel.addEventListener("change",()=>this.handlers.onVoice?.(this.voiceSel.value)),this.searchInput.addEventListener("input",()=>{this._query=this.searchInput.value.trim().toLowerCase(),this._buildList()}),this.listEl.addEventListener("click",t=>{let n=t.target.closest("[data-abs]")?.dataset.abs;n!=null&&(this.handlers.onJump?.(Number(n)),this.close())})}_buildSegments(){let e=this.curriculum.tracks?.length?this.curriculum.tracks:[{id:"full",title:"Full"}];this.trackSeg.innerHTML=e.map(t=>`<button class="tws-tour-seg__btn" data-val="${t.id}" role="radio" aria-checked="false" title="${vs(t.description||"")}">${vs((t.title||"").replace(/ tour| highlights/i,""))}${t.estimatedMinutes?` \xB7 ~${t.estimatedMinutes}m`:""}</button>`).join(""),this.speedSeg.innerHTML=tS.map(t=>`<button class="tws-tour-seg__btn" data-val="${t}" role="radio" aria-checked="false">${String(t).replace(/\.?0+$/,"")}\xD7</button>`).join("")}_buildVoices(){this.voiceSel.innerHTML=this.voices.map(e=>`<option value="${vs(e.id)}">${vs(e.name)}</option>`).join("")}_buildList(){let{sections:e=[],stops:t}=this.curriculum,n=this._query,s=[],r=e.length?e:nS(t);for(let a of r){let o=t.map((l,c)=>({s:l,abs:c})).filter(({s:l})=>l.section===a.id).filter(({s:l})=>!n||l.title.toLowerCase().includes(n));if(o.length){s.push(`<div class="tws-tour-chap"><span class="tws-tour-chap__t">${vs(a.title)}</span><span class="tws-tour-chap__n">${o.length}</span></div>`);for(let{s:l,abs:c}of o)s.push(`<button class="tws-tour-stop${c===this.activeAbs?" is-current":""}" data-abs="${c}" aria-current="${c===this.activeAbs?"true":"false"}">
						<span class="tws-tour-stop__dot"${l.highlight?' data-hl="1"':""}></span>
						<span class="tws-tour-stop__title">${vs(l.title)}</span>
						${l.highlight?'<span class="tws-tour-stop__star" title="In the Quick highlights">\u2605</span>':""}
					</button>`)}}this.listEl.innerHTML=s.join("")||`<div class="tws-tour-menu__empty">No features match \u201C${vs(this._query)}\u201D.</div>`}setActive(e){this.activeAbs=e,this.listEl.querySelectorAll(".tws-tour-stop").forEach(t=>{let n=Number(t.dataset.abs)===e;t.classList.toggle("is-current",n),t.setAttribute("aria-current",n?"true":"false")}),this.open&&this._scrollToActive()}setTrack(e){this._mark(this.trackSeg,e)}setSpeed(e){this._mark(this.speedSeg,String(e))}setVoice(e){this.voiceSel.value=e}_mark(e,t){e.querySelectorAll(".tws-tour-seg__btn").forEach(n=>{let s=n.dataset.val===t;n.classList.toggle("is-on",s),n.setAttribute("aria-checked",s?"true":"false")})}toggle(){this.open?this.close():this.show()}show(){this.open||(this.open=!0,this.root.classList.add("is-open"),this._scrollToActive(),document.addEventListener("keydown",this._onKey,!0),requestAnimationFrame(()=>this.searchInput.focus()),this.handlers.onOpenChange?.(!0))}close(){this.open&&(this.open=!1,this.root.classList.remove("is-open"),document.removeEventListener("keydown",this._onKey,!0),this.handlers.onOpenChange?.(!1))}_scrollToActive(){this.listEl.querySelector(".tws-tour-stop.is-current")?.scrollIntoView({block:"center",behavior:"auto"})}_onKey(e){e.key==="Escape"&&(e.stopPropagation(),e.preventDefault(),this.close())}dispose(){document.removeEventListener("keydown",this._onKey,!0),this.root?.remove(),this.root=null}};function nS(i){let e=new Map;for(let t of i){let n=t.section||"tour";e.has(n)||e.set(n,{id:n,title:iS(n)})}return[...e.values()]}function iS(i){return String(i||"").replace(/[-_]+/g," ").replace(/\b\w/g,e=>e.toUpperCase())}function vs(i){return String(i??"").replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e])}var Bg=!1;function sS(){if(Bg)return;Bg=!0;let i=document.createElement("style");i.id="tws-tour-menu-style",i.textContent=`
.tws-tour-menu{position:fixed;inset:0;z-index:2147483450;pointer-events:none;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
.tws-tour-menu__scrim{position:absolute;inset:0;background:rgba(6,8,12,.5);opacity:0;transition:opacity .3s ease;pointer-events:none}
.tws-tour-menu.is-open .tws-tour-menu__scrim{opacity:1;pointer-events:auto}
.tws-tour-menu__panel{position:absolute;left:0;top:0;height:100%;width:min(360px,86vw);display:flex;flex-direction:column;background:#0e1118;border-right:1px solid rgba(122,162,255,.18);box-shadow:24px 0 60px rgba(0,0,0,.5);transform:translateX(-104%);transition:transform .34s cubic-bezier(.4,0,.2,1);pointer-events:auto;color:#e7eaf2}
.tws-tour-menu.is-open .tws-tour-menu__panel{transform:translateX(0)}
.tws-tour-menu__head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px 12px;border-bottom:1px solid rgba(255,255,255,.07)}
.tws-tour-menu__title{font-weight:700;font-size:16px}
.tws-tour-menu__x{appearance:none;border:none;background:rgba(255,255,255,.06);color:#cfd5e2;width:30px;height:30px;border-radius:9px;cursor:pointer;font-size:13px;display:grid;place-items:center;transition:background .16s ease}
.tws-tour-menu__x:hover{background:rgba(220,70,70,.8);color:#fff}
.tws-tour-menu__settings{padding:14px 18px;display:flex;flex-direction:column;gap:12px;border-bottom:1px solid rgba(255,255,255,.07)}
.tws-tour-menu__field{display:flex;align-items:center;gap:12px;justify-content:space-between}
.tws-tour-menu__lbl{font-size:12.5px;color:#9aa3b6;font-weight:600;flex:0 0 auto;width:48px}
.tws-tour-seg{display:flex;gap:4px;background:rgba(255,255,255,.05);padding:3px;border-radius:10px;flex:1}
.tws-tour-seg__btn{flex:1;appearance:none;border:none;background:transparent;color:#aeb6c6;font:600 12px/1 inherit;padding:7px 6px;border-radius:7px;cursor:pointer;white-space:nowrap;transition:background .16s ease,color .16s ease}
.tws-tour-seg__btn:hover{color:#e7eaf2}
.tws-tour-seg__btn.is-on{background:linear-gradient(90deg,#7aa2ff,#9d7bff);color:#0b0e16}
.tws-tour-seg__btn:focus-visible{outline:2px solid #7aa2ff;outline-offset:1px}
.tws-tour-menu__select{flex:1;appearance:none;background:rgba(255,255,255,.05);color:#e7eaf2;border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:8px 10px;font:600 13px/1 inherit;cursor:pointer}
.tws-tour-menu__select:focus-visible{outline:2px solid #7aa2ff;outline-offset:1px}
.tws-tour-menu__search{padding:12px 18px 8px}
.tws-tour-menu__input{width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:10px;color:#e7eaf2;font:500 13.5px/1 inherit;padding:10px 12px}
.tws-tour-menu__input::placeholder{color:#7f8aa0}
.tws-tour-menu__input:focus-visible{outline:2px solid #7aa2ff;outline-offset:1px}
.tws-tour-menu__list{flex:1;overflow-y:auto;padding:4px 10px 18px;scrollbar-width:thin}
.tws-tour-chap{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 8px 6px;font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#7f8aa0;position:sticky;top:0;background:#0e1118}
.tws-tour-chap__n{font-weight:600;color:#5f697e;font-variant-numeric:tabular-nums}
.tws-tour-stop{display:flex;align-items:center;gap:10px;width:100%;text-align:left;appearance:none;border:none;background:transparent;color:#c4ccda;font:500 13.5px/1.3 inherit;padding:9px 8px;border-radius:9px;cursor:pointer;transition:background .14s ease,color .14s ease}
.tws-tour-stop:hover{background:rgba(255,255,255,.05);color:#fff}
.tws-tour-stop.is-current{background:rgba(122,162,255,.16);color:#fff}
.tws-tour-stop__dot{flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.22)}
.tws-tour-stop__dot[data-hl="1"]{background:linear-gradient(135deg,#7aa2ff,#9d7bff)}
.tws-tour-stop.is-current .tws-tour-stop__dot{background:#7aa2ff;box-shadow:0 0 0 3px rgba(122,162,255,.3)}
.tws-tour-stop__title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tws-tour-stop__star{flex:0 0 auto;color:#9d7bff;font-size:11px}
.tws-tour-menu__empty{padding:30px 14px;text-align:center;color:#7f8aa0;font-size:13px}
@media (prefers-reduced-motion:reduce){.tws-tour-menu__panel{transition:none}.tws-tour-menu__scrim{transition:none}}
`,document.head.appendChild(i)}var rS='a,button,input,textarea,select,label,summary,[role="button"],[contenteditable],[contenteditable="true"],canvas,video,iframe,[data-walk-block]';function aS(i){return!!(i&&i.closest&&i.closest(rS))}var lc=class{constructor(e){this.avatar=e,this.enabled=!1,this.dragging=!1,this._grab={x:0,y:0},this._ptr={x:0,y:0},this._scrollRaf=0,this._reduced=matchMedia("(prefers-reduced-motion: reduce)").matches,this._onDown=this._onDown.bind(this),this._onMove=this._onMove.bind(this),this._onUp=this._onUp.bind(this),cS()}enable(){this.enabled||(this.enabled=!0,this.avatar.setInteractive(!0),document.addEventListener("pointerdown",this._onDown,!0),this._hint=lS())}disable(){this.enabled&&(this.enabled=!1,this._endDrag(),document.removeEventListener("pointerdown",this._onDown,!0),this.avatar.setInteractive(!1),this.avatar.settle(),this._hint?.remove(),this._hint=null)}_onDown(e){if(!this.enabled||e.button!==0||e.altKey||e.metaKey||e.ctrlKey||e.shiftKey)return;let t=this.avatar.host;if(t&&t.contains(e.target)){let s=t.getBoundingClientRect();this._grab={x:e.clientX-s.left,y:e.clientY-s.top},this._ptr={x:e.clientX,y:e.clientY},this.dragging=!0,document.addEventListener("pointermove",this._onMove,!0),document.addEventListener("pointerup",this._onUp,!0),document.addEventListener("pointercancel",this._onUp,!0),this._startScrollLoop(),this._dismissHint(),e.preventDefault();return}if(aS(e.target))return;let n=this.avatar.size();this.avatar.walkTo({x:e.clientX-n.w/2,y:e.clientY-n.h/2}),this._reduced||oS(e.clientX,e.clientY),this._dismissHint()}_onMove(e){this.dragging&&(this._ptr={x:e.clientX,y:e.clientY},this.avatar.place({x:e.clientX-this._grab.x,y:e.clientY-this._grab.y}))}_onUp(){this._endDrag()}_endDrag(){cancelAnimationFrame(this._scrollRaf),this._scrollRaf=0,this.dragging&&(this.dragging=!1,document.removeEventListener("pointermove",this._onMove,!0),document.removeEventListener("pointerup",this._onUp,!0),document.removeEventListener("pointercancel",this._onUp,!0),this.avatar.settle())}_startScrollLoop(){if(this._reduced)return;let e=()=>{if(!this.dragging)return;let t=this._ptr.y,n=window.innerHeight,s=0;t<96?s=-22*(1-t/96):t>n-96&&(s=22*(1-(n-t)/96)),s&&(window.scrollBy(0,s),this.avatar.place({x:this._ptr.x-this._grab.x,y:this._ptr.y-this._grab.y})),this._scrollRaf=requestAnimationFrame(e)};this._scrollRaf=requestAnimationFrame(e)}_dismissHint(){if(!this._hint)return;this._hint.classList.remove("is-in");let e=this._hint;this._hint=null,setTimeout(()=>e.remove(),300)}};function oS(i,e){let t=document.createElement("div");t.className="tws-roam-ripple",t.style.left=i+"px",t.style.top=e+"px",document.body.appendChild(t),setTimeout(()=>t.remove(),600)}function lS(){let i=document.createElement("div");return i.className="tws-roam-hint",i.setAttribute("role","status"),i.innerHTML='<span class="tws-roam-hint__dot"></span>Free roam \u2014 click anywhere to walk me there, or drag me around. Press \u25B6 to rejoin the tour.',document.body.appendChild(i),requestAnimationFrame(()=>i.classList.add("is-in")),i}var Hg=!1;function cS(){if(Hg)return;Hg=!0;let i=document.createElement("style");i.id="tws-tour-roam-style",i.textContent=`
.tws-tour-guide.is-roam{pointer-events:auto;cursor:grab}
.tws-tour-guide.is-roam:active{cursor:grabbing}
.tws-roam-ripple{position:fixed;z-index:2147483090;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid rgba(122,162,255,.9);pointer-events:none;animation:tws-roam-ripple 600ms ease-out forwards}
@keyframes tws-roam-ripple{0%{transform:scale(.4);opacity:.9}100%{transform:scale(3.4);opacity:0}}
.tws-roam-hint{position:fixed;left:50%;top:18px;transform:translateX(-50%) translateY(-12px);z-index:2147483090;display:flex;align-items:center;gap:9px;max-width:min(560px,92vw);padding:10px 16px;background:rgba(14,16,22,.94);backdrop-filter:blur(10px);border:1px solid rgba(122,162,255,.3);border-radius:99px;color:#e7eaf2;font:600 13px/1.3 system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:0 12px 34px rgba(0,0,0,.45);opacity:0;transition:opacity .3s ease,transform .3s ease;pointer-events:none}
.tws-roam-hint.is-in{opacity:1;transform:translateX(-50%) translateY(0)}
.tws-roam-hint__dot{width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#7aa2ff,#9d7bff);box-shadow:0 0 10px rgba(122,162,255,.8);flex:0 0 auto}
@media (prefers-reduced-motion:reduce){.tws-roam-hint{transition:opacity .2s ease}.tws-roam-ripple{display:none}}
`,document.head.appendChild(i)}var hS=900,uS=2147483280,Qu=[1,1.25,1.5,.75],wr=class{constructor(e){this.config=e&&e.keys?e:As(e),this.state=Ms(this.config),this.curriculum=null,this.playlist=[],this.pos=0,this.index=0,this.track="full",this.paused=!1,this.muted=!1,this.voice=this.config.defaultVoice,this.speed=1,this.mounted=!1,this.offRoute=!1,this.roam=!1,this._runToken=0,this._advanceTimer=0,this._seenSections=new Set,this._beamRaf=0,this._beamActive=!1,this._onKey=this._onKey.bind(this)}async start(e){await this._ensureCurriculum();let t=this.state.readResume();this.track=e||"full",this.voice=t.voice||this.config.defaultVoice,this.speed=t.speed||1,this.muted=!1,this.paused=!1,this._seenSections=new Set,this.playlist=Ss(this.curriculum,this.track),this.pos=0,this.index=this.playlist[0]??0,this.state.writeState({active:!0,index:this.index,track:this.track,voice:this.voice,speed:this.speed,paused:!1,muted:!1});let n=this.curriculum.stops[this.index];if(nn(n.path)!==nn()){this._navigate(n.path);return}await this._mount(),this._runCurrent()}async resume(){let e=this.state.readState();if(!e.active)return;await this._ensureCurriculum(),this.paused=e.paused,this.muted=e.muted,this.voice=e.voice||this.config.defaultVoice,this.speed=e.speed||1,this.track=e.track||"full",this.playlist=Ss(this.curriculum,this.track);let t=Pa(this.curriculum,location.pathname),n=e.index||0;nn(this.curriculum.stops[n]?.path)===nn()?(this.index=n,this.offRoute=!1):t>=0?(this.index=t,this.offRoute=!1,this.state.writeState({index:t})):(this.index=n,this.offRoute=!0),this.pos=this._posForAbs(this.index),await this._mount(),this.offRoute?this._showOffRoute():this._runCurrent()}async _ensureCurriculum(){this.curriculum||(this.curriculum=await ws(this.config))}async _mount(){this.mounted||(this.mounted=!0,this._suppressCompanion(),this._buildBeam(),this.spotlight=new xr,this.narrator=new yr(this.config),this.avatar=new rc(this.config),await this.avatar.mount(),this.freeRoam=new lc(this.avatar),this.controls=new ac({onMenu:()=>this.panel?.toggle(),onPrev:()=>this._go(this.pos-1),onNext:()=>this._go(this.pos+1),onToggle:()=>this._togglePause(),onSeek:e=>this._go(e),onSpeed:()=>this._cycleSpeed(),onRoam:()=>this._toggleRoam(),onMute:()=>this._toggleMute(),onExit:()=>this.exit()}),this.panel=new oc(this.curriculum,{onJump:e=>this._jumpToAbs(e),onTrack:e=>this._applyTrack(e),onSpeed:e=>this._setSpeed(e),onVoice:e=>this._setVoice(e),onOpenChange:e=>this.controls.setMenuOpen(e)},this.config.voices),this.controls.setMuted(this.muted),this.controls.setPaused(this.paused),this.controls.setSpeed(this.speed),this.panel.setTrack(this.track),this.panel.setSpeed(this.speed),this.panel.setVoice(this.voice),document.addEventListener("keydown",this._onKey))}async _runCurrent(){let e=++this._runToken;clearTimeout(this._advanceTimer),this.offRoute=!1;let t=this.curriculum.stops[this.index];if(!t)return this._finish();if(this._syncControls(),this.panel?.setActive(this.index),this.state.writeState({index:this.index}),t.sectionIntro&&!this._seenSections.has(t.section)&&(this._seenSections.add(t.section),await this.avatar.park(),e!==this._runToken||(this.avatar.point(),await this._present(t.sectionIntro,e),e!==this._runToken)))return;let n=this._resolveTarget(t);if(n){if(await this.spotlight.highlight(n),e!==this._runToken||(await this.avatar.approach(this.spotlight.getRect()||dS(n)),e!==this._runToken))return;this._startBeam()}else if(this.spotlight.highlight(null),this._stopBeam(),await this.avatar.park(),e!==this._runToken)return;this.avatar.point(),await this._narrateAndMaybeAdvance(e)}async _narrateAndMaybeAdvance(e){await this._present(this.curriculum.stops[this.index].narration,e),e===this._runToken&&(this.paused||(this._advanceTimer=setTimeout(()=>{e===this._runToken&&this._advance()},hS/this.speed)))}async _present(e,t){this.avatar.say(e),await this.narrator.speak(e,{muted:this.muted,voice:this.voice,speed:this.speed})}_advance(){if(this.pos+1>=this.playlist.length)return this._finish();this._go(this.pos+1)}_go(e){if(!this.playlist.length)return;this.roam&&(this.roam=!1,this.freeRoam?.disable(),this.controls?.setRoam(!1));let t=Math.max(0,Math.min(this.playlist.length-1,e));this._runToken++,clearTimeout(this._advanceTimer),this.narrator?.cancel(),this.pos=t,this.index=this.playlist[t],this.state.writeState({index:this.index}),this.panel?.setActive(this.index);let n=this.curriculum.stops[this.index];nn(n.path)===nn()?this._runCurrent():this._navigate(n.path)}_jumpToAbs(e){this.playlist.indexOf(e)<0&&this._applyTrack("full",{silent:!0}),this._go(this._posForAbs(e))}_togglePause(){if(this.roam)return this._exitRoam();if(this.paused=!this.paused,this.state.writeState({paused:this.paused}),this.controls.setPaused(this.paused),this.paused)clearTimeout(this._advanceTimer),this.narrator.cancel(),this._runToken++;else if(this.offRoute)this._go(this.pos);else{let e=++this._runToken;this._narrateAndMaybeAdvance(e)}}_toggleMute(){if(this.muted=!this.muted,this.state.writeState({muted:this.muted}),this.controls.setMuted(this.muted),this.narrator.cancel(),!this.paused){let e=++this._runToken;this._narrateAndMaybeAdvance(e)}}_applyTrack(e,{silent:t=!1}={}){if(e===this.track)return;let n=this.index;this.track=e,this.playlist=Ss(this.curriculum,e),this.pos=this._posForAbs(n),this.index=this.playlist[this.pos],this.state.writeState({track:e,index:this.index}),this.panel?.setTrack(e),this._syncControls(),t||this._go(this.pos)}_cycleSpeed(){let e=Qu.indexOf(this.speed);this._setSpeed(Qu[(e+1)%Qu.length])}_setSpeed(e){let t=Math.min(2,Math.max(.5,Number(e)||1));if(t!==this.speed&&(this.speed=t,this.state.writeState({speed:t}),this.controls?.setSpeed(t),this.panel?.setSpeed(t),!this.paused&&!this.offRoute&&this.mounted)){let n=++this._runToken;this._narrateAndMaybeAdvance(n)}}_setVoice(e){if(!(!e||e===this.voice)&&(this.voice=e,this.state.writeState({voice:e}),this.panel?.setVoice(e),!this.paused&&!this.offRoute&&this.mounted)){let t=++this._runToken;this._narrateAndMaybeAdvance(t)}}_toggleRoam(){this.roam?this._exitRoam():this._enterRoam()}_enterRoam(){this.roam||(this.roam=!0,this._runToken++,clearTimeout(this._advanceTimer),this.narrator?.cancel(),this._stopBeam(),this.spotlight?.highlight(null),this.avatar?.hideBubble(),this.panel?.close(),this.controls?.setRoam(!0),this.freeRoam?.enable())}_exitRoam(){this.roam&&(this.roam=!1,this.freeRoam?.disable(),this.controls?.setRoam(!1),this.paused=!1,this.controls?.setPaused(!1),this.state.writeState({paused:!1}),this._go(this.pos))}_suppressCompanion(){let e=this.config.companion;if(!e)return;let t=window[e.global];if(!t)return;this._companionWasOn=!!(t.instance?.mounted||t.isEnabled&&t.isEnabled());let n=()=>{try{t.instance?.mounted&&t.instance.unmount()}catch{}};n(),this._onCompanionChange=n,window.addEventListener(e.changeEvent,this._onCompanionChange)}_restoreCompanion(){let e=this.config.companion;if(e&&this._onCompanionChange&&(window.removeEventListener(e.changeEvent,this._onCompanionChange),this._onCompanionChange=null),!e)return;let t=window[e.global];if(!(!t||!this._companionWasOn))try{t.instance?.mounted||(t.instance?t.instance.mount():t.enable?.())}catch{}}_posForAbs(e){let t=this.playlist.indexOf(e);if(t>=0)return t;let n=0,s=1/0;return this.playlist.forEach((r,a)=>{let o=Math.abs(r-e);o<s&&(s=o,n=a)}),n}_showOffRoute(){this._stopBeam(),this.spotlight.highlight(null),this.avatar.park(),this.paused=!0,this.state.writeState({paused:!0}),this.controls.setPaused(!0),this._syncControls(),this.panel?.setActive(this.index),this.avatar.say(this.config.copy.offRoute)}async _finish(){let e=++this._runToken;this._stopBeam(),this.spotlight.highlight(null),await this.avatar.park(),this.avatar.point(),await this._present(this.config.copy.outro,e),e===this._runToken&&(this.state.markCompleted(),this.state.clearState(),document.removeEventListener("keydown",this._onKey),this._showCompletion())}_showCompletion(){let e=this.config.copy.completion,t=document.createElement("div");t.className="tws-tour-done";let n=e.primary?`<a class="tws-tour-done__btn tws-tour-done__btn--primary" href="${mS(e.primary.href)}">${vr(e.primary.label)}</a>`:"";t.innerHTML=`
			<div class="tws-tour-done__inner" role="dialog" aria-label="Tour complete">
				<div class="tws-tour-done__title">${vr(e.title)}</div>
				<p class="tws-tour-done__body">${vr(e.body)}</p>
				<div class="tws-tour-done__actions">
					${n}
					<button class="tws-tour-done__btn" data-act="restart">${vr(e.restartLabel)}</button>
					<button class="tws-tour-done__btn" data-act="close">${vr(e.closeLabel)}</button>
				</div>
			</div>`,gS(),document.body.appendChild(t),requestAnimationFrame(()=>t.classList.add("is-in")),t.addEventListener("click",s=>{let r=s.target.closest("[data-act]")?.dataset.act;r==="restart"?(t.remove(),this.start(this.track)):r==="close"&&(t.remove(),this.exit())}),this._doneCard=t}exit(){this._runToken++,clearTimeout(this._advanceTimer),this.state.clearState(),this._stopBeam(),this._beam?.remove(),document.removeEventListener("keydown",this._onKey),this.roam=!1,this.freeRoam?.disable(),this.narrator?.dispose(),this.spotlight?.dispose(),this.avatar?.dispose(),this.controls?.dispose(),this.panel?.dispose(),this._doneCard?.remove(),this._restoreCompanion(),this.mounted=!1}_resolveTarget(e){let t=[...e.targets||[],"[data-tour-target]","main h1, .hero h1, h1",'a.cta, .btn-primary, button[type="submit"], main a.button, .hero a'];for(let n of t){let s;try{s=document.querySelector(n)}catch{continue}if(fS(s))return s}return null}_buildBeam(){let e=document.createElementNS("http://www.w3.org/2000/svg","svg");e.setAttribute("class","tws-tour-beam"),e.style.cssText=`position:fixed;inset:0;width:100vw;height:100vh;z-index:${uS};pointer-events:none;opacity:0;transition:opacity .3s ease`,e.innerHTML=`
			<defs>
				<marker id="tws-tour-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
					<path d="M0,0 L10,5 L0,10 z" fill="rgba(122,162,255,.95)"/>
				</marker>
			</defs>
			<line class="tws-tour-beam__line" stroke="rgba(122,162,255,.9)" stroke-width="2.5" stroke-dasharray="2 7" stroke-linecap="round" marker-end="url(#tws-tour-arrow)"/>
		`,document.body.appendChild(e),this._beam=e,this._beamLine=e.querySelector(".tws-tour-beam__line")}_startBeam(){if(this._beamActive)return;this._beamActive=!0,this._beam.style.opacity="1";let e=()=>{if(!this._beamActive)return;let t=this.spotlight.getRect(),n=this.avatar.headScreen();if(t&&n){let s=zg(n.x,t.left,t.left+t.width),r=zg(n.y,t.top,t.top+t.height);this._beamLine.setAttribute("x1",n.x),this._beamLine.setAttribute("y1",n.y),this._beamLine.setAttribute("x2",s),this._beamLine.setAttribute("y2",r)}this._beamRaf=requestAnimationFrame(e)};this._beamRaf=requestAnimationFrame(e)}_stopBeam(){this._beamActive=!1,cancelAnimationFrame(this._beamRaf),this._beam&&(this._beam.style.opacity="0")}_syncControls(){let e=this.curriculum.stops[this.index];this.controls.update({chapter:Ia(this.curriculum,e.section),index:this.pos,total:this.playlist.length})}_navigate(e){this.config.navigate(e)}_onKey(e){this.panel?.open||pS(e.target)||(e.key===" "||e.key==="k"?(e.preventDefault(),this._togglePause()):e.key==="ArrowRight"?this._go(this.pos+1):e.key==="ArrowLeft"?this._go(this.pos-1):e.key==="m"||e.key==="M"?this._toggleMute():e.key==="c"||e.key==="C"?this.panel?.toggle():e.key==="r"||e.key==="R"?this._toggleRoam():e.key==="Escape"&&(this.roam?this._exitRoam():this.exit()))}};function zg(i,e,t){return Math.min(t,Math.max(e,i))}function dS(i){let e=i.getBoundingClientRect();return{left:e.left,top:e.top,width:e.width,height:e.height,cx:e.left+e.width/2,cy:e.top+e.height/2}}function fS(i){if(!i||!i.isConnected)return!1;let e=i.getBoundingClientRect();if(e.width<4||e.height<4)return!1;let t=getComputedStyle(i);return t.visibility!=="hidden"&&t.display!=="none"&&Number(t.opacity)>.05}function pS(i){if(!i)return!1;let e=i.tagName;return e==="INPUT"||e==="TEXTAREA"||e==="SELECT"||i.isContentEditable}function vr(i){return String(i??"").replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e])}function mS(i){return vr(i)}var Gg=!1;function gS(){if(Gg)return;Gg=!0;let i=document.createElement("style");i.textContent=`
.tws-tour-done{position:fixed;inset:0;z-index:2147483500;display:grid;place-items:center;background:rgba(6,8,12,.6);backdrop-filter:blur(6px);opacity:0;transition:opacity .35s ease;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
.tws-tour-done.is-in{opacity:1}
.tws-tour-done__inner{background:#11141c;border:1px solid rgba(122,162,255,.25);border-radius:20px;padding:28px 30px;max-width:380px;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.tws-tour-done__title{font-size:22px;font-weight:700;color:#f2f4f8;margin-bottom:8px}
.tws-tour-done__body{color:#aeb6c6;font-size:14px;line-height:1.5;margin:0 0 20px}
.tws-tour-done__actions{display:flex;flex-direction:column;gap:10px}
.tws-tour-done__btn{appearance:none;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#eef1f6;padding:11px 16px;border-radius:11px;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;display:block;transition:background .18s ease,border-color .18s ease}
.tws-tour-done__btn:hover{background:rgba(255,255,255,.1)}
.tws-tour-done__btn--primary{background:linear-gradient(90deg,#7aa2ff,#9d7bff);color:#0b0e16;border-color:transparent}
.tws-tour-done__btn--primary:hover{filter:brightness(1.06)}
`,document.head.appendChild(i)}var Vg=2147483400,Mr=class{constructor(e,t){this.config=e,this.curriculum=t,this.movement=e.mode==="platformer"?"platformer":"stroll",this.spotlight=null,this.narrator=null,this.stops=[],this.pg=null,this.running=!1,this._reduced=matchMedia("(prefers-reduced-motion: reduce)").matches,this._onPgExit=()=>{this.running&&this.exit()},this._onPgMode=()=>{this.running&&this._hudState&&this._setHud(...this._hudState)}}isActive(){return this.running}async start(){if(this.running)return;this.running=!0;let e=nn(),t=(this.curriculum?.stops||[]).filter(n=>!n.path||nn(n.path)===e);if(this.stops=t.map(n=>({stop:n,el:this._resolveTarget(n)})).filter(n=>n.el),!this.stops.length){this._toast("Nothing to explore on this page yet."),this.exit();return}this.spotlight=new xr,this.narrator=new yr(this.config),this._buildHud(),wi(),window.scrollTo({top:0,behavior:"auto"}),this.pg=sc({mode:this.movement,config:this._walkConfig(),avatarId:this.config.guideAvatarId,checkpoints:this.stops.map(n=>({el:n.el})),onReach:(n,s)=>this._reach(n,s),onComplete:()=>this._finish()}),window.addEventListener("walk-playground:exit",this._onPgExit),window.addEventListener("walk-playground:mode",this._onPgMode),this._activate(0)}exit(){this.running=!1,window.removeEventListener("walk-playground:exit",this._onPgExit),window.removeEventListener("walk-playground:mode",this._onPgMode);try{wi()}catch{}this.pg=null,this.narrator?.cancel?.(),this.spotlight?.dispose(),this.spotlight=null,this._hud?.remove(),this._hud=null}async _reach(e,t){let{stop:n,el:s}=this.stops[e];if(this._setHud(e,!0),await this.spotlight.highlight(s),await this.narrator.speak(n.narration,{muted:!1,voice:this.config.defaultVoice,speed:1}),!this.running)return;this.spotlight.highlight(null);let r=e+1;r<this.stops.length&&this._activate(r),t()}_activate(e){this._setHud(e,!1)}_finish(){this.spotlight?.highlight(null),this._setHud(this.stops.length-1,!1,!0)}_buildHud(){let e=document.createElement("div");e.className="tws-cp-hud",e.innerHTML=`
			<div class="tws-cp-hud__row">
				<span class="tws-cp-hud__badge" id="tws-cp-count"></span>
				<span class="tws-cp-hud__msg" id="tws-cp-msg"></span>
			</div>
			<div class="tws-cp-hud__dots" id="tws-cp-dots"></div>
			<button class="tws-cp-hud__mode" id="tws-cp-mode" type="button" aria-label="Switch movement mode">
				<span class="tws-cp-hud__mode-ic" id="tws-cp-mode-ic">\u{1F6B6}</span>
				<span id="tws-cp-mode-name">Stroll</span>
				<span class="tws-cp-hud__mode-swap">tap or press M to switch</span>
			</button>
			<button class="tws-cp-hud__exit" id="tws-cp-exit" aria-label="Exit">\u2715 Exit</button>`,qg(),document.body.appendChild(e),this._hud=e,e.querySelector("#tws-cp-dots").innerHTML=this.stops.map(()=>"<i></i>").join(""),e.querySelector("#tws-cp-exit").addEventListener("click",()=>this.exit()),e.querySelector("#tws-cp-mode").addEventListener("click",()=>Vi()),this._reachedCount=0,this._syncMode()}_syncMode(){if(!this._hud)return;let e=Ta()==="platformer",t=this._hud.querySelector("#tws-cp-mode-ic"),n=this._hud.querySelector("#tws-cp-mode-name");t&&(t.textContent=e?"\u{1F3AE}":"\u{1F6B6}"),n&&(n.textContent=e?"Platformer":"Stroll")}_setHud(e,t,n=!1){if(!this._hud)return;this._hudState=[e,t,n],this._syncMode();let s=this.stops.length;t&&(this._reachedCount=Math.max(this._reachedCount||0,e+1));let r=n?s:this._reachedCount||0,a=this._hud.querySelector("#tws-cp-count"),o=this._hud.querySelector("#tws-cp-msg");if([...this._hud.querySelectorAll("#tws-cp-dots i")].forEach((c,h)=>{c.classList.toggle("done",h<r),c.classList.toggle("active",h===e&&h>=r)}),n){a.textContent="\u{1F389} All done",o.textContent=`You found all ${s} spots. Press \u2715 to finish.`;return}a.textContent=`\u{1F3AF} ${r} / ${s}`,o.textContent=t?this.stops[e].stop.title||"Here we are":this._instruction()}_instruction(){let e=Ta()==="platformer";return this._touch()?e?"Use the buttons to run and jump to the glowing checkpoint.":"Use the joystick to walk to the glowing checkpoint.":e?"Arrow keys to run, Space to jump \u2014 reach the glowing checkpoint.":"Use arrow keys to walk to the glowing checkpoint."}_touch(){return matchMedia("(pointer: coarse)").matches||"ontouchstart"in window}_walkConfig(){return Gi({assetBase:this.config.assetBase||"",apiBase:this.config.apiBase||"",manifestUrl:this.config.manifestUrl||"/animations/manifest.json",defaultAvatarId:this.config.guideAvatarId||"realistic-female"})}_resolveTarget(e){let t=[...e.targets||[],"[data-tour-target]","main h1, .hero h1, h1",'a.cta, .btn-primary, button[type="submit"], main a.button, .hero a'];for(let n of t){let s;try{s=document.querySelector(n)}catch{continue}if(_S(s))return s}return null}_toast(e){let t=document.createElement("div");t.className="tws-cp-toast",t.textContent=e,qg(),document.body.appendChild(t),requestAnimationFrame(()=>t.classList.add("is-in")),setTimeout(()=>{t.classList.remove("is-in"),setTimeout(()=>t.remove(),300)},2600)}};function _S(i){if(!i||!i.isConnected)return!1;let e=i.getBoundingClientRect();if(e.width<4||e.height<4)return!1;let t=getComputedStyle(i);return t.visibility!=="hidden"&&t.display!=="none"&&Number(t.opacity)>.05}var Wg=!1;function qg(){if(Wg||typeof document>"u")return;Wg=!0;let i=document.createElement("style");i.id="tws-tour-explore-hud",i.textContent=`
.tws-cp-hud{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:${Vg};display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 18px;background:rgba(14,16,22,.94);backdrop-filter:blur(12px);border:1px solid rgba(122,162,255,.28);border-radius:16px;color:#e7eaf2;font:600 13px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.5);max-width:min(520px,94vw)}
.tws-cp-hud__row{display:flex;align-items:center;gap:12px}
.tws-cp-hud__badge{font-weight:800;white-space:nowrap}
.tws-cp-hud__msg{color:#aeb6c8}
.tws-cp-hud__dots{display:flex;gap:6px}
.tws-cp-hud__dots i{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.18);transition:.2s}
.tws-cp-hud__dots i.active{background:#6ee7b7;box-shadow:0 0 8px rgba(110,231,183,.8);transform:scale(1.2)}
.tws-cp-hud__dots i.done{background:#34d399}
.tws-cp-hud__mode{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(122,162,255,.4);background:rgba(122,162,255,.14);color:#e7eaf2;font:700 12px/1 inherit;padding:8px 13px;border-radius:999px;cursor:pointer;pointer-events:auto;transition:background .18s ease,border-color .18s ease,transform .12s ease}
.tws-cp-hud__mode:hover{background:rgba(122,162,255,.3);border-color:rgba(122,162,255,.65)}
.tws-cp-hud__mode:active{transform:scale(.97)}
.tws-cp-hud__mode:focus-visible{outline:2px solid #7aa2ff;outline-offset:2px}
.tws-cp-hud__mode-ic{font-size:14px;line-height:1}
.tws-cp-hud__mode-swap{color:#aeb6c8;font-weight:600;font-size:11px}
.tws-cp-hud__exit{position:absolute;top:-14px;right:-10px;border:1px solid rgba(255,255,255,.16);background:rgba(20,24,34,.95);color:#cfd5e4;font:700 11px/1 inherit;padding:6px 10px;border-radius:99px;cursor:pointer;pointer-events:auto}
.tws-cp-hud__exit:hover{color:#fff;border-color:rgba(248,113,113,.7)}
.tws-cp-toast{position:fixed;left:50%;top:20px;transform:translateX(-50%) translateY(-10px);z-index:${Vg};padding:11px 18px;background:rgba(14,16,22,.95);border:1px solid rgba(122,162,255,.3);border-radius:12px;color:#e7eaf2;font:600 13px/1.3 system-ui,sans-serif;opacity:0;transition:.3s;box-shadow:0 10px 30px rgba(0,0,0,.5)}
.tws-cp-toast.is-in{opacity:1;transform:translateX(-50%) translateY(0)}
`,document.head.appendChild(i)}var bS=["Here we have","Next up,","This is","Take a look at","Now,","Let's visit","Over here is","Here's","Meet","And this \u2014","Check out","This one is"];function Yg(i,e={}){let t=Array.isArray(i?.sections)?i.sections:[],n=e.sectionIntros||{},s=e.sectionHeroes||{},r=e.targets||{},a=new Set(e.deny||[]),o=e.denyPrefix||[],l=e.skipAuthRequired!==!1,c=Number.isFinite(e.quickPerSection)?e.quickPerSection:3,h=e.connectors?.length?e.connectors:bS,u=e.wpm||150,d=e.stopOverheadS??9,f=e.sectionOrder?.length?e.sectionOrder:t.map(E=>E.id),m=new Map;for(let E of t){let _=(E.pages||[]).filter(A=>A&&A.path&&!(l&&A.auth==="required")&&!a.has(A.path)&&!o.some(k=>A.path.startsWith(k)));_.length&&m.set(E.id,{meta:E,pages:_})}let b=[],g=[],p=0,x=0,w=0;for(let E of f){let _=m.get(E);if(!_)continue;let A=xS(s[E]||[],_.pages),k=n[E]||"";g.push({id:E,title:_.meta.title||MS(E),intro:k}),A.forEach((R,D)=>{let B=D===0,W=D<c,I=yS(R,b.length,h),G=B&&k?k.split(/\s+/).length:0,j=I.split(/\s+/).length+G;p+=j,W&&(x+=j,w+=1),b.push({id:wS(R.path),path:R.path,section:E,title:cc(R.title),narration:I,highlight:W,...B&&k?{sectionIntro:k}:{},...r[R.path]?{targets:r[R.path]}:{}})})}let y=Xg(p,b.length,u,d),S=Math.max(1,Xg(x,w,u,d));return{version:2,generatedBy:"@three-ws/tour buildCurriculum",title:e.title||"Guided Tour",tagline:e.tagline||"A 3D guide walks you through every feature, live, on the real site.",estimatedMinutes:y,stopCount:b.length,tracks:[{id:"full",title:"Full tour",description:"Every feature, chapter by chapter.",stopCount:b.length,estimatedMinutes:y},{id:"quick",title:"Quick highlights",description:"The best of every chapter, in a few minutes.",stopCount:w,estimatedMinutes:S}],sections:g,stops:b}}function xS(i,e){let t=new Map(i.map((n,s)=>[n,s]));return[...e].sort((n,s)=>{let r=t.has(n.path)?t.get(n.path):1/0,a=t.has(s.path)?t.get(s.path):1/0;if(r!==a)return r-a;let o=n.added||"",l=s.added||"";return o!==l?o<l?1:-1:(n.title||"").localeCompare(s.title||"")})}function yS(i,e,t){let n=t[e%t.length],s=cc(i.title),r=cc(i.description||""),a=new RegExp(`^${vS(s)}\\s*[\u2014:-]\\s*`,"i");return r=r.replace(a,""),r=jg(r),`${n} ${jg(s).replace(/\.$/,"")}. ${r}`.trim()}function Xg(i,e,t,n){return Math.round(i/t+e*n/60)}function cc(i){return String(i||"").replace(/\s+/g," ").trim()}function jg(i){return i=cc(i),i&&(/[.!?]$/.test(i)?i:i+".")}function vS(i){return i.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function wS(i){return String(i).replace(/^\/+/,"").replace(/\/+$/,"").replace(/[^a-z0-9]+/gi,"-").toLowerCase()||"home"}function MS(i){return String(i||"").replace(/[-_]+/g," ").replace(/\b\w/g,e=>e.toUpperCase())}var SS="0.5.2";function ed(i={}){let e=As(i),t=Ms(e),n=null,s=null,r=()=>n||(n=new wr(e)),a=()=>e.mode==="explore"||e.mode==="platformer";async function o(){if(s?.isActive())return;let c=e.curriculum&&typeof e.curriculum=="object"?e.curriculum:await ws(e);return s=new Mr(e,c),s.start()}let l={get director(){return n},get explore(){return s},get config(){return e},isActive(){return s?.isActive()===!0||t.readState().active===!0},start(c){return a()?o():r().start(c)},startExplore:o,resume(){return a()?o():r().resume()},exit(){s?.exit(),n?.exit()},bootstrap(){if(typeof window>"u"||window.top!==window.self)return;let c=new URLSearchParams(location.search),h=c.get(e.deepLinkParam);h==="start"?a()?o():r().start(c.get("track")==="quick"?"quick":"full"):h==="0"?l.exit():(h==="1"||!a()&&t.readState().active)&&l.resume()}};return l}var AS="https://three.ws",ES="https://three.ws/animations/manifest.json";function Kg(){if(window.__featureTour)return;let i=document.currentScript||document.querySelector("script[data-tour]");if(!i||!i.hasAttribute("data-tour"))return;let e=i.dataset;if(!e.curriculum){console.warn('[three-ws/tour] <script data-tour> needs data-curriculum="<url>"');return}let t=ed({curriculum:e.curriculum,guideAvatarId:e.avatar||"realistic-female",assetBase:e.assetBase||AS,manifestUrl:e.manifestUrl||ES,ttsEndpoint:e.ttsEndpoint||null,mode:e.mode==="explore"||e.mode==="platformer"?e.mode:"guided"});window.__featureTour=t,t.bootstrap();let n=s=>{for(let r of s.querySelectorAll("[data-tour-start]"))r.__twsTourWired||(r.__twsTourWired=!0,r.addEventListener("click",a=>{a.preventDefault(),t.start(r.getAttribute("data-tour-start")==="quick"?"quick":"full")}))};n(document),new MutationObserver(()=>n(document)).observe(document.body,{childList:!0,subtree:!0}),e.autostart&&t.start(e.autostart==="quick"?"quick":"full")}typeof window<"u"&&(document.readyState==="loading"?document.addEventListener("DOMContentLoaded",Kg,{once:!0}):Kg());return r0(TS);})();
if(typeof window!=="undefined"){window.createFeatureTour=ThreeWsTour.createFeatureTour;}
