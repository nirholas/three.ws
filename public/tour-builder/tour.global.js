"use strict";var ThreeWsTour=(()=>{var gl=Object.defineProperty;var jg=Object.getOwnPropertyDescriptor;var Yg=Object.getOwnPropertyNames;var Kg=Object.prototype.hasOwnProperty;var ct=(i,e)=>()=>(i&&(e=i(i=0)),e);var Ca=(i,e)=>{for(var t in e)gl(i,t,{get:e[t],enumerable:!0})},Jg=(i,e,t,n)=>{if(e&&typeof e=="object"||typeof e=="function")for(let s of Yg(e))!Kg.call(i,s)&&s!==t&&gl(i,s,{get:()=>e[s],enumerable:!(n=jg(e,s))||n.enumerable});return i};var $g=i=>Jg(gl({},"__esModule",{value:!0}),i);function t0(i){for(let e=i.length-1;e>=0;--e)if(i[e]>=65535)return!0;return!1}function Lf(i){return ArrayBuffer.isView(i)&&!(i instanceof DataView)}function Xs(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function Pf(){let i=Xs("canvas");return i.style.display="block",i}function Nr(...i){let e="THREE."+i.shift();js?js("log",e,...i):console.log(e,...i)}function If(i){let e=i[0];if(typeof e=="string"&&e.startsWith("TSL:")){let t=i[1];t&&t.isStackTrace?i[0]+=" "+t.getLocation():i[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return i}function ye(...i){i=If(i);let e="THREE."+i.shift();if(js)js("warn",e,...i);else{let t=i[0];t&&t.isStackTrace?console.warn(t.getError(e)):console.warn(e,...i)}}function Te(...i){i=If(i);let e="THREE."+i.shift();if(js)js("error",e,...i);else{let t=i[0];t&&t.isStackTrace?console.error(t.getError(e)):console.error(e,...i)}}function go(...i){let e=i.join(" ");e in md||(md[e]=!0,ye(...i))}function kf(i,e,t){return new Promise(function(n,s){function r(){switch(i.clientWaitSync(e,i.SYNC_FLUSH_COMMANDS_BIT,0)){case i.WAIT_FAILED:s();break;case i.TIMEOUT_EXPIRED:setTimeout(r,t);break;default:n()}}setTimeout(r,t)})}function kn(){let i=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Wt[i&255]+Wt[i>>8&255]+Wt[i>>16&255]+Wt[i>>24&255]+"-"+Wt[e&255]+Wt[e>>8&255]+"-"+Wt[e>>16&15|64]+Wt[e>>24&255]+"-"+Wt[t&63|128]+Wt[t>>8&255]+"-"+Wt[t>>16&255]+Wt[t>>24&255]+Wt[n&255]+Wt[n>>8&255]+Wt[n>>16&255]+Wt[n>>24&255]).toLowerCase()}function We(i,e,t){return Math.max(e,Math.min(t,i))}function Mh(i,e){return(i%e+e)%e}function n0(i,e,t,n,s){return n+(i-e)*(s-n)/(t-e)}function i0(i,e,t){return i!==e?(t-i)/(e-i):0}function kr(i,e,t){return(1-t)*i+t*e}function s0(i,e,t,n){return kr(i,e,1-Math.exp(-t*n))}function r0(i,e=1){return e-Math.abs(Mh(i,e*2)-e)}function a0(i,e,t){return i<=e?0:i>=t?1:(i=(i-e)/(t-e),i*i*(3-2*i))}function o0(i,e,t){return i<=e?0:i>=t?1:(i=(i-e)/(t-e),i*i*i*(i*(i*6-15)+10))}function c0(i,e){return i+Math.floor(Math.random()*(e-i+1))}function l0(i,e){return i+Math.random()*(e-i)}function h0(i){return i*(.5-Math.random())}function u0(i){i!==void 0&&(gd=i);let e=gd+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function d0(i){return i*Ir}function f0(i){return i*rs}function p0(i){return(i&i-1)===0&&i!==0}function m0(i){return Math.pow(2,Math.ceil(Math.log(i)/Math.LN2))}function g0(i){return Math.pow(2,Math.floor(Math.log(i)/Math.LN2))}function _0(i,e,t,n,s){let r=Math.cos,a=Math.sin,o=r(t/2),c=a(t/2),l=r((e+n)/2),h=a((e+n)/2),u=r((e-n)/2),d=a((e-n)/2),f=r((n-e)/2),g=a((n-e)/2);switch(s){case"XYX":i.set(o*h,c*u,c*d,o*l);break;case"YZY":i.set(c*d,o*h,c*u,o*l);break;case"ZXZ":i.set(c*u,c*d,o*h,o*l);break;case"XZX":i.set(o*h,c*g,c*f,o*l);break;case"YXY":i.set(c*f,o*h,c*g,o*l);break;case"ZYZ":i.set(c*g,c*f,o*h,o*l);break;default:ye("MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+s)}}function Pn(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return i/4294967295;case Uint16Array:return i/65535;case Uint8Array:return i/255;case Int32Array:return Math.max(i/2147483647,-1);case Int16Array:return Math.max(i/32767,-1);case Int8Array:return Math.max(i/127,-1);default:throw new Error("Invalid component type.")}}function Ze(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return Math.round(i*4294967295);case Uint16Array:return Math.round(i*65535);case Uint8Array:return Math.round(i*255);case Int32Array:return Math.round(i*2147483647);case Int16Array:return Math.round(i*32767);case Int8Array:return Math.round(i*127);default:throw new Error("Invalid component type.")}}function b0(){let i={enabled:!0,workingColorSpace:Jt,spaces:{},convert:function(s,r,a){return this.enabled===!1||r===a||!r||!a||(this.spaces[r].transfer===$e&&(s.r=di(s.r),s.g=di(s.g),s.b=di(s.b)),this.spaces[r].primaries!==this.spaces[a].primaries&&(s.applyMatrix3(this.spaces[r].toXYZ),s.applyMatrix3(this.spaces[a].fromXYZ)),this.spaces[a].transfer===$e&&(s.r=Gs(s.r),s.g=Gs(s.g),s.b=Gs(s.b))),s},workingToColorSpace:function(s,r){return this.convert(s,this.workingColorSpace,r)},colorSpaceToWorking:function(s,r){return this.convert(s,r,this.workingColorSpace)},getPrimaries:function(s){return this.spaces[s].primaries},getTransfer:function(s){return s===_i?Fr:this.spaces[s].transfer},getToneMappingMode:function(s){return this.spaces[s].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(s,r=this.workingColorSpace){return s.fromArray(this.spaces[r].luminanceCoefficients)},define:function(s){Object.assign(this.spaces,s)},_getMatrix:function(s,r,a){return s.copy(this.spaces[r].toXYZ).multiply(this.spaces[a].fromXYZ)},_getDrawingBufferColorSpace:function(s){return this.spaces[s].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(s=this.workingColorSpace){return this.spaces[s].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(s,r){return go("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),i.workingToColorSpace(s,r)},toWorkingColorSpace:function(s,r){return go("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),i.colorSpaceToWorking(s,r)}},e=[.64,.33,.3,.6,.15,.06],t=[.2126,.7152,.0722],n=[.3127,.329];return i.define({[Jt]:{primaries:e,whitePoint:n,transfer:Fr,toXYZ:bd,fromXYZ:xd,luminanceCoefficients:t,workingColorSpaceConfig:{unpackColorSpace:Pt},outputColorSpaceConfig:{drawingBufferColorSpace:Pt}},[Pt]:{primaries:e,whitePoint:n,transfer:$e,toXYZ:bd,fromXYZ:xd,luminanceCoefficients:t,outputColorSpaceConfig:{drawingBufferColorSpace:Pt}}}),i}function di(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function Gs(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}function yl(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?_o.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(ye("Texture: Unable to serialize Texture."),{})}function Sl(i,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?i+(e-i)*6*t:t<1/2?e:t<2/3?i+(e-i)*6*(2/3-t):i}function Il(i,e,t,n,s){for(let r=0,a=i.length-3;r<=a;r+=3){Yi.fromArray(i,r);let o=s.x*Math.abs(Yi.x)+s.y*Math.abs(Yi.y)+s.z*Math.abs(Yi.z),c=e.dot(Yi),l=t.dot(Yi),h=n.dot(Yi);if(Math.max(-Math.max(c,l,h),Math.min(c,l,h))>o)return!1}return!0}function I0(i,e,t,n,s,r,a,o){let c;if(e.side===Zt?c=n.intersectTriangle(a,r,s,!0,o):c=n.intersectTriangle(s,r,a,e.side===Dn,o),c===null)return null;ja.copy(o),ja.applyMatrix4(i.matrixWorld);let l=t.ray.origin.distanceTo(ja);return l<t.near||l>t.far?null:{distance:l,point:ja.clone(),object:i}}function Ya(i,e,t,n,s,r,a,o,c,l){i.getVertexPosition(o,Ga),i.getVertexPosition(c,Wa),i.getVertexPosition(l,qa);let h=I0(i,e,t,n,Ga,Wa,qa,Ld);if(h){let u=new L;Ci.getBarycoord(Ld,Ga,Wa,qa,u),s&&(h.uv=Ci.getInterpolatedAttribute(s,o,c,l,u,new Ie)),r&&(h.uv1=Ci.getInterpolatedAttribute(r,o,c,l,u,new Ie)),a&&(h.normal=Ci.getInterpolatedAttribute(a,o,c,l,u,new L),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));let d={a:o,b:c,c:l,normal:new L,materialIndex:0};Ci.getNormal(Ga,Wa,qa,d.normal),h.face=d,h.barycoord=u}return h}function Qa(i,e,t,n,s,r,a){let o=i.geometry.attributes.position;if(vo.fromBufferAttribute(o,s),yo.fromBufferAttribute(o,r),t.distanceSqToSegment(vo,yo,Vl,Bd)>n)return;Vl.applyMatrix4(i.matrixWorld);let l=e.ray.origin.distanceTo(Vl);if(!(l<e.near||l>e.far))return{distance:l,point:Bd.clone().applyMatrix4(i.matrixWorld),index:a,face:null,faceIndex:null,barycoord:null,object:i}}function Gd(i,e,t,n,s,r,a){let o=Yl.distanceSqToPoint(i);if(o<t){let c=new L;Yl.closestPointToPoint(i,c),c.applyMatrix4(n);let l=s.ray.origin.distanceTo(c);if(l<s.near||l>s.far)return;r.push({distance:l,distanceToRay:Math.sqrt(o),point:c,index:e,face:null,faceIndex:null,barycoord:null,object:a})}}function ms(i){let e={};for(let t in i){e[t]={};for(let n in i[t]){let s=i[t][n];if(Wd(s))s.isRenderTargetTexture?(ye("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=s.clone();else if(Array.isArray(s))if(Wd(s[0])){let r=[];for(let a=0,o=s.length;a<o;a++)r[a]=s[a].clone();e[t][n]=r}else e[t][n]=s.slice();else e[t][n]=s}}return e}function jt(i){let e={};for(let t=0;t<i.length;t++){let n=ms(i[t]);for(let s in n)e[s]=n[s]}return e}function Wd(i){return i&&(i.isColor||i.isMatrix3||i.isMatrix4||i.isVector2||i.isVector3||i.isVector4||i.isTexture||i.isQuaternion)}function B0(i){let e=[];for(let t=0;t<i.length;t++)e.push(i[t].clone());return e}function Sh(i){let e=i.getRenderTarget();return e===null?i.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:ze.workingColorSpace}function es(i,e){return!i||i.constructor===e?i:typeof e.BYTES_PER_ELEMENT=="number"?new e(i):Array.prototype.slice.call(i)}function Uf(i){function e(s,r){return i[s]-i[r]}let t=i.length,n=new Array(t);for(let s=0;s!==t;++s)n[s]=s;return n.sort(e),n}function Kl(i,e,t){let n=i.length,s=new i.constructor(n);for(let r=0,a=0;a!==n;++r){let o=t[r]*e;for(let c=0;c!==e;++c)s[a++]=i[o+c]}return s}function Ah(i,e,t,n){let s=1,r=i[0];for(;r!==void 0&&r[n]===void 0;)r=i[s++];if(r===void 0)return;let a=r[n];if(a!==void 0)if(Array.isArray(a))do a=r[n],a!==void 0&&(e.push(r.time),t.push(...a)),r=i[s++];while(r!==void 0);else if(a.toArray!==void 0)do a=r[n],a!==void 0&&(e.push(r.time),a.toArray(t,t.length)),r=i[s++];while(r!==void 0);else do a=r[n],a!==void 0&&(e.push(r.time),t.push(a)),r=i[s++];while(r!==void 0)}function V0(i,e,t,n,s=30){let r=i.clone();r.name=e;let a=[];for(let c=0;c<r.tracks.length;++c){let l=r.tracks[c],h=l.getValueSize(),u=[],d=[];for(let f=0;f<l.times.length;++f){let g=l.times[f]*s;if(!(g<t||g>=n)){u.push(l.times[f]);for(let _=0;_<h;++_)d.push(l.values[f*h+_])}}u.length!==0&&(l.times=es(u,l.times.constructor),l.values=es(d,l.values.constructor),a.push(l))}r.tracks=a;let o=1/0;for(let c=0;c<r.tracks.length;++c)o>r.tracks[c].times[0]&&(o=r.tracks[c].times[0]);for(let c=0;c<r.tracks.length;++c)r.tracks[c].shift(-1*o);return r.resetDuration(),r}function G0(i,e=0,t=i,n=30){n<=0&&(n=30);let s=t.tracks.length,r=e/n;for(let a=0;a<s;++a){let o=t.tracks[a],c=o.ValueTypeName;if(c==="bool"||c==="string")continue;let l=i.tracks.find(function(p){return p.name===o.name&&p.ValueTypeName===c});if(l===void 0)continue;let h=0,u=o.getValueSize();o.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline&&(h=u/3);let d=0,f=l.getValueSize();l.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline&&(d=f/3);let g=o.times.length-1,_;if(r<=o.times[0]){let p=h,x=u-h;_=o.values.slice(p,x)}else if(r>=o.times[g]){let p=g*u+h,x=p+u-h;_=o.values.slice(p,x)}else{let p=o.createInterpolant(),x=h,y=u-h;p.evaluate(r),_=p.resultBuffer.slice(x,y)}c==="quaternion"&&new ge().fromArray(_).normalize().conjugate().toArray(_);let m=l.times.length;for(let p=0;p<m;++p){let x=p*f+d;if(c==="quaternion")ge.multiplyQuaternionsFlat(l.values,x,_,0,l.values,x);else{let y=f-d*2;for(let w=0;w<y;++w)l.values[x+w]-=_[w]}}}return i.blendMode=da,i}function W0(i){switch(i.toLowerCase()){case"scalar":case"double":case"float":case"number":case"integer":return Mn;case"vector":case"vector2":case"vector3":case"vector4":return Kn;case"color":return $r;case"quaternion":return Sn;case"bool":case"boolean":return pi;case"string":return mi}throw new Error("THREE.KeyframeTrack: Unsupported typeName: "+i)}function q0(i){if(i.type===void 0)throw new Error("THREE.KeyframeTrack: track type undefined, can not parse");let e=W0(i.type);if(i.times===void 0){let t=[],n=[];Ah(i.keys,t,n,"value"),i.times=t,i.values=n}return e.parse!==void 0?e.parse(i):new e(i.name,i.times,i.values,i.interpolation)}function qd(i){try{let e=i.slice(i.indexOf(":")+1);return new URL(e).protocol==="blob:"}catch{return!1}}function X0(){this._document.hidden===!1&&this.reset()}function Rh(i,e,t,n){let s=n_(n);switch(t){case xh:return i*e;case Go:return i*e/s.components*s.byteLength;case Wo:return i*e/s.components*s.byteLength;case Hi:return i*e*2/s.components*s.byteLength;case qo:return i*e*2/s.components*s.byteLength;case vh:return i*e*3/s.components*s.byteLength;case gn:return i*e*4/s.components*s.byteLength;case Xo:return i*e*4/s.components*s.byteLength;case aa:case oa:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case ca:case la:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case Yo:case Jo:return Math.max(i,16)*Math.max(e,8)/4;case jo:case Ko:return Math.max(i,8)*Math.max(e,8)/2;case $o:case Zo:case ec:case tc:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case Qo:case ha:case nc:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case ic:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case sc:return Math.floor((i+4)/5)*Math.floor((e+3)/4)*16;case rc:return Math.floor((i+4)/5)*Math.floor((e+4)/5)*16;case ac:return Math.floor((i+5)/6)*Math.floor((e+4)/5)*16;case oc:return Math.floor((i+5)/6)*Math.floor((e+5)/6)*16;case cc:return Math.floor((i+7)/8)*Math.floor((e+4)/5)*16;case lc:return Math.floor((i+7)/8)*Math.floor((e+5)/6)*16;case hc:return Math.floor((i+7)/8)*Math.floor((e+7)/8)*16;case uc:return Math.floor((i+9)/10)*Math.floor((e+4)/5)*16;case dc:return Math.floor((i+9)/10)*Math.floor((e+5)/6)*16;case fc:return Math.floor((i+9)/10)*Math.floor((e+7)/8)*16;case pc:return Math.floor((i+9)/10)*Math.floor((e+9)/10)*16;case mc:return Math.floor((i+11)/12)*Math.floor((e+9)/10)*16;case gc:return Math.floor((i+11)/12)*Math.floor((e+11)/12)*16;case _c:case bc:case xc:return Math.ceil(i/4)*Math.ceil(e/4)*16;case vc:case yc:return Math.ceil(i/4)*Math.ceil(e/4)*8;case ua:case wc:return Math.ceil(i/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function n_(i){switch(i){case an:case mh:return{byteLength:1,components:1};case cr:case gh:case Qn:return{byteLength:2,components:1};case zo:case Vo:return{byteLength:2,components:4};case Bn:case Ho:case mn:return{byteLength:4,components:1};case _h:case bh:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${i}.`)}var Jd,nh,$d,sa,Zd,ar,Dn,Zt,rn,Zn,ts,ih,sh,rh,Qd,Li,ef,tf,nf,sf,rf,af,of,cf,ro,ao,lf,hf,uf,df,ff,pf,mf,gf,_f,oo,co,lo,ns,ho,uo,fo,po,ah,bf,xf,Un,oh,ch,lh,hh,uh,dh,fh,ql,vf,ph,Oi,ds,Uo,Oo,ra,Pi,wn,Ws,yt,Bo,fs,wt,or,On,an,mh,gh,cr,Ho,Bn,mn,Qn,zo,Vo,lr,_h,bh,xh,vh,gn,jn,Bi,Go,Wo,Hi,qo,Xo,aa,oa,ca,la,jo,Yo,Ko,Jo,$o,Zo,Qo,ec,tc,ha,nc,ic,sc,rc,ac,oc,cc,lc,hc,uc,dc,fc,pc,mc,gc,_c,bc,xc,vc,yc,ua,wc,zi,ps,yf,is,ss,so,Xl,Zi,Qi,Dr,Mc,da,yh,fa,hr,wf,Sc,Mf,_i,Pt,Jt,Fr,$e,$i,jl,Sf,Af,Ef,Ac,Tf,Rf,Ec,Cf,mo,wh,In,qs,md,js,Df,Fn,Wt,gd,Ir,rs,_t,Ch,Ie,ge,Lh,L,xl,_d,Ph,ke,vl,bd,xd,ze,Cs,_o,x0,Ys,v0,wl,Ot,Ih,st,bo,dn,Ur,xo,No,Le,Ls,Rn,y0,w0,Mi,ka,hn,vd,yd,Bt,Or,M0,wd,Ps,ai,Da,Sr,S0,A0,Md,Sd,Ad,Ed,E0,Is,Ml,rt,Nt,T0,Ks,Ff,Si,Fa,Ee,qt,Ii,Cn,oi,Al,ci,ks,Ds,Td,El,Tl,Rl,Cl,Ll,Pl,Ci,Tt,li,Ln,Na,Fs,Ns,Us,Ai,Ei,ji,Ar,Ua,Oa,Yi,St,Ba,R0,Et,Br,Hr,Ut,C0,Er,kl,en,L0,yn,Dl,Os,un,Tr,Ft,Xt,Js,Kt,$s,P0,tn,hi,Fl,Ha,Ti,Nl,za,Ul,as,fn,Rd,Ki,Va,Cd,Ga,Wa,qa,Ol,Xa,Ld,ja,It,Rr,Pd,Id,k0,kd,Ka,Bl,Dd,Hl,os,Zs,Qs,Fd,D0,cs,ki,Bs,Nd,Ja,Ud,F0,Cr,Lr,zr,zl,N0,U0,qn,Ji,O0,$a,er,tr,vo,yo,Od,Pr,Za,Vl,Bd,ls,Hd,zd,Vr,Gr,nr,Vd,Yl,eo,to,Wr,qr,fi,wo,Xr,ir,jr,Yr,Nf,H0,z0,pn,Mo,hs,nn,So,Ao,Kr,Yn,Eo,Jr,To,Ro,sn,pi,$r,Mn,Co,Sn,mi,Kn,$t,Xn,Lo,Of,Jn,ui,Jl,sr,Hs,Po,Zr,Di,Fi,Gl,Xd,jd,Qr,no,io,Wn,ea,Ri,Yd,Kd,At,$l,ta,Zl,na,Nn,Ql,$n,Ni,gi,Wl,ia,zs,Vs,Io,ko,Ui,Do,Eh,j0,Th,Y0,K0,J0,$0,Z0,Q0,e_,eh,it,Fo,t_,us,rr,kh,th,Dh=ct(()=>{Jd=0,nh=1,$d=2,sa=1,Zd=2,ar=3,Dn=0,Zt=1,rn=2,Zn=0,ts=1,ih=2,sh=3,rh=4,Qd=5,Li=100,ef=101,tf=102,nf=103,sf=104,rf=200,af=201,of=202,cf=203,ro=204,ao=205,lf=206,hf=207,uf=208,df=209,ff=210,pf=211,mf=212,gf=213,_f=214,oo=0,co=1,lo=2,ns=3,ho=4,uo=5,fo=6,po=7,ah=0,bf=1,xf=2,Un=0,oh=1,ch=2,lh=3,hh=4,uh=5,dh=6,fh=7,ql="attached",vf="detached",ph=300,Oi=301,ds=302,Uo=303,Oo=304,ra=306,Pi=1e3,wn=1001,Ws=1002,yt=1003,Bo=1004,fs=1005,wt=1006,or=1007,On=1008,an=1009,mh=1010,gh=1011,cr=1012,Ho=1013,Bn=1014,mn=1015,Qn=1016,zo=1017,Vo=1018,lr=1020,_h=35902,bh=35899,xh=1021,vh=1022,gn=1023,jn=1026,Bi=1027,Go=1028,Wo=1029,Hi=1030,qo=1031,Xo=1033,aa=33776,oa=33777,ca=33778,la=33779,jo=35840,Yo=35841,Ko=35842,Jo=35843,$o=36196,Zo=37492,Qo=37496,ec=37488,tc=37489,ha=37490,nc=37491,ic=37808,sc=37809,rc=37810,ac=37811,oc=37812,cc=37813,lc=37814,hc=37815,uc=37816,dc=37817,fc=37818,pc=37819,mc=37820,gc=37821,_c=36492,bc=36494,xc=36495,vc=36283,yc=36284,ua=36285,wc=36286,zi=2200,ps=2201,yf=2202,is=2300,ss=2301,so=2302,Xl=2303,Zi=2400,Qi=2401,Dr=2402,Mc=2500,da=2501,yh=0,fa=1,hr=2,wf=3200,Sc=0,Mf=1,_i="",Pt="srgb",Jt="srgb-linear",Fr="linear",$e="srgb",$i=7680,jl=519,Sf=512,Af=513,Ef=514,Ac=515,Tf=516,Rf=517,Ec=518,Cf=519,mo=35044,wh="300 es",In=2e3,qs=2001;md={},js=null;Df={[oo]:co,[lo]:fo,[ho]:po,[ns]:uo,[co]:oo,[fo]:lo,[po]:ho,[uo]:ns},Fn=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){let n=this._listeners;return n===void 0?!1:n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){let n=this._listeners;if(n===void 0)return;let s=n[e];if(s!==void 0){let r=s.indexOf(t);r!==-1&&s.splice(r,1)}}dispatchEvent(e){let t=this._listeners;if(t===void 0)return;let n=t[e.type];if(n!==void 0){e.target=this;let s=n.slice(0);for(let r=0,a=s.length;r<a;r++)s[r].call(this,e);e.target=null}}},Wt=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],gd=1234567,Ir=Math.PI/180,rs=180/Math.PI;_t={DEG2RAD:Ir,RAD2DEG:rs,generateUUID:kn,clamp:We,euclideanModulo:Mh,mapLinear:n0,inverseLerp:i0,lerp:kr,damp:s0,pingpong:r0,smoothstep:a0,smootherstep:o0,randInt:c0,randFloat:l0,randFloatSpread:h0,seededRandom:u0,degToRad:d0,radToDeg:f0,isPowerOfTwo:p0,ceilPowerOfTwo:m0,floorPowerOfTwo:g0,setQuaternionFromProperEuler:_0,normalize:Ze,denormalize:Pn},Ch=class Ch{constructor(e=0,t=0){this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,n=this.y,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6],this.y=s[1]*t+s[4]*n+s[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=We(this.x,e.x,t.x),this.y=We(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=We(this.x,e,t),this.y=We(this.y,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(We(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(We(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let n=Math.cos(t),s=Math.sin(t),r=this.x-e.x,a=this.y-e.y;return this.x=r*n-a*s+e.x,this.y=r*s+a*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}};Ch.prototype.isVector2=!0;Ie=Ch,ge=class{constructor(e=0,t=0,n=0,s=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=s}static slerpFlat(e,t,n,s,r,a,o){let c=n[s+0],l=n[s+1],h=n[s+2],u=n[s+3],d=r[a+0],f=r[a+1],g=r[a+2],_=r[a+3];if(u!==_||c!==d||l!==f||h!==g){let m=c*d+l*f+h*g+u*_;m<0&&(d=-d,f=-f,g=-g,_=-_,m=-m);let p=1-o;if(m<.9995){let x=Math.acos(m),y=Math.sin(x);p=Math.sin(p*x)/y,o=Math.sin(o*x)/y,c=c*p+d*o,l=l*p+f*o,h=h*p+g*o,u=u*p+_*o}else{c=c*p+d*o,l=l*p+f*o,h=h*p+g*o,u=u*p+_*o;let x=1/Math.sqrt(c*c+l*l+h*h+u*u);c*=x,l*=x,h*=x,u*=x}}e[t]=c,e[t+1]=l,e[t+2]=h,e[t+3]=u}static multiplyQuaternionsFlat(e,t,n,s,r,a){let o=n[s],c=n[s+1],l=n[s+2],h=n[s+3],u=r[a],d=r[a+1],f=r[a+2],g=r[a+3];return e[t]=o*g+h*u+c*f-l*d,e[t+1]=c*g+h*d+l*u-o*f,e[t+2]=l*g+h*f+o*d-c*u,e[t+3]=h*g-o*u-c*d-l*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,s){return this._x=e,this._y=t,this._z=n,this._w=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,s=e._y,r=e._z,a=e._order,o=Math.cos,c=Math.sin,l=o(n/2),h=o(s/2),u=o(r/2),d=c(n/2),f=c(s/2),g=c(r/2);switch(a){case"XYZ":this._x=d*h*u+l*f*g,this._y=l*f*u-d*h*g,this._z=l*h*g+d*f*u,this._w=l*h*u-d*f*g;break;case"YXZ":this._x=d*h*u+l*f*g,this._y=l*f*u-d*h*g,this._z=l*h*g-d*f*u,this._w=l*h*u+d*f*g;break;case"ZXY":this._x=d*h*u-l*f*g,this._y=l*f*u+d*h*g,this._z=l*h*g+d*f*u,this._w=l*h*u-d*f*g;break;case"ZYX":this._x=d*h*u-l*f*g,this._y=l*f*u+d*h*g,this._z=l*h*g-d*f*u,this._w=l*h*u+d*f*g;break;case"YZX":this._x=d*h*u+l*f*g,this._y=l*f*u+d*h*g,this._z=l*h*g-d*f*u,this._w=l*h*u-d*f*g;break;case"XZY":this._x=d*h*u-l*f*g,this._y=l*f*u-d*h*g,this._z=l*h*g+d*f*u,this._w=l*h*u+d*f*g;break;default:ye("Quaternion: .setFromEuler() encountered an unknown order: "+a)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,s=Math.sin(n);return this._x=e.x*s,this._y=e.y*s,this._z=e.z*s,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],s=t[4],r=t[8],a=t[1],o=t[5],c=t[9],l=t[2],h=t[6],u=t[10],d=n+o+u;if(d>0){let f=.5/Math.sqrt(d+1);this._w=.25/f,this._x=(h-c)*f,this._y=(r-l)*f,this._z=(a-s)*f}else if(n>o&&n>u){let f=2*Math.sqrt(1+n-o-u);this._w=(h-c)/f,this._x=.25*f,this._y=(s+a)/f,this._z=(r+l)/f}else if(o>u){let f=2*Math.sqrt(1+o-n-u);this._w=(r-l)/f,this._x=(s+a)/f,this._y=.25*f,this._z=(c+h)/f}else{let f=2*Math.sqrt(1+u-n-o);this._w=(a-s)/f,this._x=(r+l)/f,this._y=(c+h)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<1e-8?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(We(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let s=Math.min(1,t/n);return this.slerp(e,s),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,s=e._y,r=e._z,a=e._w,o=t._x,c=t._y,l=t._z,h=t._w;return this._x=n*h+a*o+s*l-r*c,this._y=s*h+a*c+r*o-n*l,this._z=r*h+a*l+n*c-s*o,this._w=a*h-n*o-s*c-r*l,this._onChangeCallback(),this}slerp(e,t){let n=e._x,s=e._y,r=e._z,a=e._w,o=this.dot(e);o<0&&(n=-n,s=-s,r=-r,a=-a,o=-o);let c=1-t;if(o<.9995){let l=Math.acos(o),h=Math.sin(l);c=Math.sin(c*l)/h,t=Math.sin(t*l)/h,this._x=this._x*c+n*t,this._y=this._y*c+s*t,this._z=this._z*c+r*t,this._w=this._w*c+a*t,this._onChangeCallback()}else this._x=this._x*c+n*t,this._y=this._y*c+s*t,this._z=this._z*c+r*t,this._w=this._w*c+a*t,this.normalize();return this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),s=Math.sqrt(1-n),r=Math.sqrt(n);return this.set(s*Math.sin(e),s*Math.cos(e),r*Math.sin(t),r*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},Lh=class Lh{constructor(e=0,t=0,n=0){this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(_d.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(_d.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6]*s,this.y=r[1]*t+r[4]*n+r[7]*s,this.z=r[2]*t+r[5]*n+r[8]*s,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,s=this.z,r=e.elements,a=1/(r[3]*t+r[7]*n+r[11]*s+r[15]);return this.x=(r[0]*t+r[4]*n+r[8]*s+r[12])*a,this.y=(r[1]*t+r[5]*n+r[9]*s+r[13])*a,this.z=(r[2]*t+r[6]*n+r[10]*s+r[14])*a,this}applyQuaternion(e){let t=this.x,n=this.y,s=this.z,r=e.x,a=e.y,o=e.z,c=e.w,l=2*(a*s-o*n),h=2*(o*t-r*s),u=2*(r*n-a*t);return this.x=t+c*l+a*u-o*h,this.y=n+c*h+o*l-r*u,this.z=s+c*u+r*h-a*l,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[4]*n+r[8]*s,this.y=r[1]*t+r[5]*n+r[9]*s,this.z=r[2]*t+r[6]*n+r[10]*s,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=We(this.x,e.x,t.x),this.y=We(this.y,e.y,t.y),this.z=We(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=We(this.x,e,t),this.y=We(this.y,e,t),this.z=We(this.z,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(We(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,s=e.y,r=e.z,a=t.x,o=t.y,c=t.z;return this.x=s*c-r*o,this.y=r*a-n*c,this.z=n*o-s*a,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return xl.copy(this).projectOnVector(e),this.sub(xl)}reflect(e){return this.sub(xl.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(We(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,s=this.z-e.z;return t*t+n*n+s*s}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let s=Math.sin(t)*e;return this.x=s*Math.sin(n),this.y=Math.cos(t)*e,this.z=s*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),s=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=s,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}};Lh.prototype.isVector3=!0;L=Lh,xl=new L,_d=new ge,Ph=class Ph{constructor(e,t,n,s,r,a,o,c,l){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,a,o,c,l)}set(e,t,n,s,r,a,o,c,l){let h=this.elements;return h[0]=e,h[1]=s,h[2]=o,h[3]=t,h[4]=r,h[5]=c,h[6]=n,h[7]=a,h[8]=l,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,s=t.elements,r=this.elements,a=n[0],o=n[3],c=n[6],l=n[1],h=n[4],u=n[7],d=n[2],f=n[5],g=n[8],_=s[0],m=s[3],p=s[6],x=s[1],y=s[4],w=s[7],A=s[2],S=s[5],R=s[8];return r[0]=a*_+o*x+c*A,r[3]=a*m+o*y+c*S,r[6]=a*p+o*w+c*R,r[1]=l*_+h*x+u*A,r[4]=l*m+h*y+u*S,r[7]=l*p+h*w+u*R,r[2]=d*_+f*x+g*A,r[5]=d*m+f*y+g*S,r[8]=d*p+f*w+g*R,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],a=e[4],o=e[5],c=e[6],l=e[7],h=e[8];return t*a*h-t*o*l-n*r*h+n*o*c+s*r*l-s*a*c}invert(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],a=e[4],o=e[5],c=e[6],l=e[7],h=e[8],u=h*a-o*l,d=o*c-h*r,f=l*r-a*c,g=t*u+n*d+s*f;if(g===0)return this.set(0,0,0,0,0,0,0,0,0);let _=1/g;return e[0]=u*_,e[1]=(s*l-h*n)*_,e[2]=(o*n-s*a)*_,e[3]=d*_,e[4]=(h*t-s*c)*_,e[5]=(s*r-o*t)*_,e[6]=f*_,e[7]=(n*c-l*t)*_,e[8]=(a*t-n*r)*_,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,s,r,a,o){let c=Math.cos(r),l=Math.sin(r);return this.set(n*c,n*l,-n*(c*a+l*o)+a+e,-s*l,s*c,-s*(-l*a+c*o)+o+t,0,0,1),this}scale(e,t){return this.premultiply(vl.makeScale(e,t)),this}rotate(e){return this.premultiply(vl.makeRotation(-e)),this}translate(e,t){return this.premultiply(vl.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let s=0;s<9;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}};Ph.prototype.isMatrix3=!0;ke=Ph,vl=new ke,bd=new ke().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),xd=new ke().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);ze=b0();_o=class{static getDataURL(e,t="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let n;if(e instanceof HTMLCanvasElement)n=e;else{Cs===void 0&&(Cs=Xs("canvas")),Cs.width=e.width,Cs.height=e.height;let s=Cs.getContext("2d");e instanceof ImageData?s.putImageData(e,0,0):s.drawImage(e,0,0,e.width,e.height),n=Cs}return n.toDataURL(t)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let t=Xs("canvas");t.width=e.width,t.height=e.height;let n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);let s=n.getImageData(0,0,e.width,e.height),r=s.data;for(let a=0;a<r.length;a++)r[a]=di(r[a]/255)*255;return n.putImageData(s,0,0),t}else if(e.data){let t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(di(t[n]/255)*255):t[n]=di(t[n]);return{data:t,width:e.width,height:e.height}}else return ye("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},x0=0,Ys=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:x0++}),this.uuid=kn(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let t=this.data;return typeof HTMLVideoElement<"u"&&t instanceof HTMLVideoElement?e.set(t.videoWidth,t.videoHeight,0):typeof VideoFrame<"u"&&t instanceof VideoFrame?e.set(t.displayWidth,t.displayHeight,0):t!==null?e.set(t.width,t.height,t.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let n={uuid:this.uuid,url:""},s=this.data;if(s!==null){let r;if(Array.isArray(s)){r=[];for(let a=0,o=s.length;a<o;a++)s[a].isDataTexture?r.push(yl(s[a].image)):r.push(yl(s[a]))}else r=yl(s);n.url=r}return t||(e.images[this.uuid]=n),n}};v0=0,wl=new L,Ot=class i extends Fn{constructor(e=i.DEFAULT_IMAGE,t=i.DEFAULT_MAPPING,n=wn,s=wn,r=wt,a=On,o=gn,c=an,l=i.DEFAULT_ANISOTROPY,h=_i){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:v0++}),this.uuid=kn(),this.name="",this.source=new Ys(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=s,this.magFilter=r,this.minFilter=a,this.anisotropy=l,this.format=o,this.internalFormat=null,this.type=c,this.offset=new Ie(0,0),this.repeat=new Ie(1,1),this.center=new Ie(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new ke,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=h,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(wl).x}get height(){return this.source.getSize(wl).y}get depth(){return this.source.getSize(wl).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let t in e){let n=e[t];if(n===void 0){ye(`Texture.setValues(): parameter '${t}' has value of undefined.`);continue}let s=this[t];if(s===void 0){ye(`Texture.setValues(): property '${t}' does not exist.`);continue}s&&n&&s.isVector2&&n.isVector2||s&&n&&s.isVector3&&n.isVector3||s&&n&&s.isMatrix3&&n.isMatrix3?s.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let n={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==ph)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case Pi:e.x=e.x-Math.floor(e.x);break;case wn:e.x=e.x<0?0:1;break;case Ws:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case Pi:e.y=e.y-Math.floor(e.y);break;case wn:e.y=e.y<0?0:1;break;case Ws:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};Ot.DEFAULT_IMAGE=null;Ot.DEFAULT_MAPPING=ph;Ot.DEFAULT_ANISOTROPY=1;Ih=class Ih{constructor(e=0,t=0,n=0,s=1){this.x=e,this.y=t,this.z=n,this.w=s}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,s){return this.x=e,this.y=t,this.z=n,this.w=s,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,s=this.z,r=this.w,a=e.elements;return this.x=a[0]*t+a[4]*n+a[8]*s+a[12]*r,this.y=a[1]*t+a[5]*n+a[9]*s+a[13]*r,this.z=a[2]*t+a[6]*n+a[10]*s+a[14]*r,this.w=a[3]*t+a[7]*n+a[11]*s+a[15]*r,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,s,r,c=e.elements,l=c[0],h=c[4],u=c[8],d=c[1],f=c[5],g=c[9],_=c[2],m=c[6],p=c[10];if(Math.abs(h-d)<.01&&Math.abs(u-_)<.01&&Math.abs(g-m)<.01){if(Math.abs(h+d)<.1&&Math.abs(u+_)<.1&&Math.abs(g+m)<.1&&Math.abs(l+f+p-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;let y=(l+1)/2,w=(f+1)/2,A=(p+1)/2,S=(h+d)/4,R=(u+_)/4,b=(g+m)/4;return y>w&&y>A?y<.01?(n=0,s=.707106781,r=.707106781):(n=Math.sqrt(y),s=S/n,r=R/n):w>A?w<.01?(n=.707106781,s=0,r=.707106781):(s=Math.sqrt(w),n=S/s,r=b/s):A<.01?(n=.707106781,s=.707106781,r=0):(r=Math.sqrt(A),n=R/r,s=b/r),this.set(n,s,r,t),this}let x=Math.sqrt((m-g)*(m-g)+(u-_)*(u-_)+(d-h)*(d-h));return Math.abs(x)<.001&&(x=1),this.x=(m-g)/x,this.y=(u-_)/x,this.z=(d-h)/x,this.w=Math.acos((l+f+p-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=We(this.x,e.x,t.x),this.y=We(this.y,e.y,t.y),this.z=We(this.z,e.z,t.z),this.w=We(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=We(this.x,e,t),this.y=We(this.y,e,t),this.z=We(this.z,e,t),this.w=We(this.w,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(We(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}};Ih.prototype.isVector4=!0;st=Ih,bo=class extends Fn{constructor(e=1,t=1,n={}){super(),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:wt,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},n),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=n.depth,this.scissor=new st(0,0,e,t),this.scissorTest=!1,this.viewport=new st(0,0,e,t),this.textures=[];let s={width:e,height:t,depth:n.depth},r=new Ot(s),a=n.count;for(let o=0;o<a;o++)this.textures[o]=r.clone(),this.textures[o].isRenderTargetTexture=!0,this.textures[o].renderTarget=this;this._setTextureOptions(n),this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples,this.multiview=n.multiview}_setTextureOptions(e={}){let t={minFilter:wt,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(t.mapping=e.mapping),e.wrapS!==void 0&&(t.wrapS=e.wrapS),e.wrapT!==void 0&&(t.wrapT=e.wrapT),e.wrapR!==void 0&&(t.wrapR=e.wrapR),e.magFilter!==void 0&&(t.magFilter=e.magFilter),e.minFilter!==void 0&&(t.minFilter=e.minFilter),e.format!==void 0&&(t.format=e.format),e.type!==void 0&&(t.type=e.type),e.anisotropy!==void 0&&(t.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(t.colorSpace=e.colorSpace),e.flipY!==void 0&&(t.flipY=e.flipY),e.generateMipmaps!==void 0&&(t.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(t.internalFormat=e.internalFormat);for(let n=0;n<this.textures.length;n++)this.textures[n].setValues(t)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let s=0,r=this.textures.length;s<r;s++)this.textures[s].image.width=e,this.textures[s].image.height=t,this.textures[s].image.depth=n,this.textures[s].isData3DTexture!==!0&&(this.textures[s].isArrayTexture=this.textures[s].image.depth>1);this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let t=0,n=e.textures.length;t<n;t++){this.textures[t]=e.textures[t].clone(),this.textures[t].isRenderTargetTexture=!0,this.textures[t].renderTarget=this;let s=Object.assign({},e.textures[t].image);this.textures[t].source=new Ys(s)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this.multiview=e.multiview,this}dispose(){this.dispatchEvent({type:"dispose"})}},dn=class extends bo{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}},Ur=class extends Ot{constructor(e=null,t=1,n=1,s=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=yt,this.minFilter=yt,this.wrapR=wn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}},xo=class extends Ot{constructor(e=null,t=1,n=1,s=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=yt,this.minFilter=yt,this.wrapR=wn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}},No=class No{constructor(e,t,n,s,r,a,o,c,l,h,u,d,f,g,_,m){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,a,o,c,l,h,u,d,f,g,_,m)}set(e,t,n,s,r,a,o,c,l,h,u,d,f,g,_,m){let p=this.elements;return p[0]=e,p[4]=t,p[8]=n,p[12]=s,p[1]=r,p[5]=a,p[9]=o,p[13]=c,p[2]=l,p[6]=h,p[10]=u,p[14]=d,p[3]=f,p[7]=g,p[11]=_,p[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new No().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return this.determinant()===0?(e.set(1,0,0),t.set(0,1,0),n.set(0,0,1),this):(e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this)}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){if(e.determinant()===0)return this.identity();let t=this.elements,n=e.elements,s=1/Ls.setFromMatrixColumn(e,0).length(),r=1/Ls.setFromMatrixColumn(e,1).length(),a=1/Ls.setFromMatrixColumn(e,2).length();return t[0]=n[0]*s,t[1]=n[1]*s,t[2]=n[2]*s,t[3]=0,t[4]=n[4]*r,t[5]=n[5]*r,t[6]=n[6]*r,t[7]=0,t[8]=n[8]*a,t[9]=n[9]*a,t[10]=n[10]*a,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,s=e.y,r=e.z,a=Math.cos(n),o=Math.sin(n),c=Math.cos(s),l=Math.sin(s),h=Math.cos(r),u=Math.sin(r);if(e.order==="XYZ"){let d=a*h,f=a*u,g=o*h,_=o*u;t[0]=c*h,t[4]=-c*u,t[8]=l,t[1]=f+g*l,t[5]=d-_*l,t[9]=-o*c,t[2]=_-d*l,t[6]=g+f*l,t[10]=a*c}else if(e.order==="YXZ"){let d=c*h,f=c*u,g=l*h,_=l*u;t[0]=d+_*o,t[4]=g*o-f,t[8]=a*l,t[1]=a*u,t[5]=a*h,t[9]=-o,t[2]=f*o-g,t[6]=_+d*o,t[10]=a*c}else if(e.order==="ZXY"){let d=c*h,f=c*u,g=l*h,_=l*u;t[0]=d-_*o,t[4]=-a*u,t[8]=g+f*o,t[1]=f+g*o,t[5]=a*h,t[9]=_-d*o,t[2]=-a*l,t[6]=o,t[10]=a*c}else if(e.order==="ZYX"){let d=a*h,f=a*u,g=o*h,_=o*u;t[0]=c*h,t[4]=g*l-f,t[8]=d*l+_,t[1]=c*u,t[5]=_*l+d,t[9]=f*l-g,t[2]=-l,t[6]=o*c,t[10]=a*c}else if(e.order==="YZX"){let d=a*c,f=a*l,g=o*c,_=o*l;t[0]=c*h,t[4]=_-d*u,t[8]=g*u+f,t[1]=u,t[5]=a*h,t[9]=-o*h,t[2]=-l*h,t[6]=f*u+g,t[10]=d-_*u}else if(e.order==="XZY"){let d=a*c,f=a*l,g=o*c,_=o*l;t[0]=c*h,t[4]=-u,t[8]=l*h,t[1]=d*u+_,t[5]=a*h,t[9]=f*u-g,t[2]=g*u-f,t[6]=o*h,t[10]=_*u+d}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(y0,e,w0)}lookAt(e,t,n){let s=this.elements;return hn.subVectors(e,t),hn.lengthSq()===0&&(hn.z=1),hn.normalize(),Mi.crossVectors(n,hn),Mi.lengthSq()===0&&(Math.abs(n.z)===1?hn.x+=1e-4:hn.z+=1e-4,hn.normalize(),Mi.crossVectors(n,hn)),Mi.normalize(),ka.crossVectors(hn,Mi),s[0]=Mi.x,s[4]=ka.x,s[8]=hn.x,s[1]=Mi.y,s[5]=ka.y,s[9]=hn.y,s[2]=Mi.z,s[6]=ka.z,s[10]=hn.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,s=t.elements,r=this.elements,a=n[0],o=n[4],c=n[8],l=n[12],h=n[1],u=n[5],d=n[9],f=n[13],g=n[2],_=n[6],m=n[10],p=n[14],x=n[3],y=n[7],w=n[11],A=n[15],S=s[0],R=s[4],b=s[8],T=s[12],P=s[1],C=s[5],N=s[9],G=s[13],q=s[2],F=s[6],H=s[10],V=s[14],Z=s[3],Q=s[7],le=s[11],xe=s[15];return r[0]=a*S+o*P+c*q+l*Z,r[4]=a*R+o*C+c*F+l*Q,r[8]=a*b+o*N+c*H+l*le,r[12]=a*T+o*G+c*V+l*xe,r[1]=h*S+u*P+d*q+f*Z,r[5]=h*R+u*C+d*F+f*Q,r[9]=h*b+u*N+d*H+f*le,r[13]=h*T+u*G+d*V+f*xe,r[2]=g*S+_*P+m*q+p*Z,r[6]=g*R+_*C+m*F+p*Q,r[10]=g*b+_*N+m*H+p*le,r[14]=g*T+_*G+m*V+p*xe,r[3]=x*S+y*P+w*q+A*Z,r[7]=x*R+y*C+w*F+A*Q,r[11]=x*b+y*N+w*H+A*le,r[15]=x*T+y*G+w*V+A*xe,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],s=e[8],r=e[12],a=e[1],o=e[5],c=e[9],l=e[13],h=e[2],u=e[6],d=e[10],f=e[14],g=e[3],_=e[7],m=e[11],p=e[15],x=c*f-l*d,y=o*f-l*u,w=o*d-c*u,A=a*f-l*h,S=a*d-c*h,R=a*u-o*h;return t*(_*x-m*y+p*w)-n*(g*x-m*A+p*S)+s*(g*y-_*A+p*R)-r*(g*w-_*S+m*R)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let s=this.elements;return e.isVector3?(s[12]=e.x,s[13]=e.y,s[14]=e.z):(s[12]=e,s[13]=t,s[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],a=e[4],o=e[5],c=e[6],l=e[7],h=e[8],u=e[9],d=e[10],f=e[11],g=e[12],_=e[13],m=e[14],p=e[15],x=t*o-n*a,y=t*c-s*a,w=t*l-r*a,A=n*c-s*o,S=n*l-r*o,R=s*l-r*c,b=h*_-u*g,T=h*m-d*g,P=h*p-f*g,C=u*m-d*_,N=u*p-f*_,G=d*p-f*m,q=x*G-y*N+w*C+A*P-S*T+R*b;if(q===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let F=1/q;return e[0]=(o*G-c*N+l*C)*F,e[1]=(s*N-n*G-r*C)*F,e[2]=(_*R-m*S+p*A)*F,e[3]=(d*S-u*R-f*A)*F,e[4]=(c*P-a*G-l*T)*F,e[5]=(t*G-s*P+r*T)*F,e[6]=(m*w-g*R-p*y)*F,e[7]=(h*R-d*w+f*y)*F,e[8]=(a*N-o*P+l*b)*F,e[9]=(n*P-t*N-r*b)*F,e[10]=(g*S-_*w+p*x)*F,e[11]=(u*w-h*S-f*x)*F,e[12]=(o*T-a*C-c*b)*F,e[13]=(t*C-n*T+s*b)*F,e[14]=(_*y-g*A-m*x)*F,e[15]=(h*A-u*y+d*x)*F,this}scale(e){let t=this.elements,n=e.x,s=e.y,r=e.z;return t[0]*=n,t[4]*=s,t[8]*=r,t[1]*=n,t[5]*=s,t[9]*=r,t[2]*=n,t[6]*=s,t[10]*=r,t[3]*=n,t[7]*=s,t[11]*=r,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],s=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,s))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),s=Math.sin(t),r=1-n,a=e.x,o=e.y,c=e.z,l=r*a,h=r*o;return this.set(l*a+n,l*o-s*c,l*c+s*o,0,l*o+s*c,h*o+n,h*c-s*a,0,l*c-s*o,h*c+s*a,r*c*c+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,s,r,a){return this.set(1,n,r,0,e,1,a,0,t,s,1,0,0,0,0,1),this}compose(e,t,n){let s=this.elements,r=t._x,a=t._y,o=t._z,c=t._w,l=r+r,h=a+a,u=o+o,d=r*l,f=r*h,g=r*u,_=a*h,m=a*u,p=o*u,x=c*l,y=c*h,w=c*u,A=n.x,S=n.y,R=n.z;return s[0]=(1-(_+p))*A,s[1]=(f+w)*A,s[2]=(g-y)*A,s[3]=0,s[4]=(f-w)*S,s[5]=(1-(d+p))*S,s[6]=(m+x)*S,s[7]=0,s[8]=(g+y)*R,s[9]=(m-x)*R,s[10]=(1-(d+_))*R,s[11]=0,s[12]=e.x,s[13]=e.y,s[14]=e.z,s[15]=1,this}decompose(e,t,n){let s=this.elements;e.x=s[12],e.y=s[13],e.z=s[14];let r=this.determinant();if(r===0)return n.set(1,1,1),t.identity(),this;let a=Ls.set(s[0],s[1],s[2]).length(),o=Ls.set(s[4],s[5],s[6]).length(),c=Ls.set(s[8],s[9],s[10]).length();r<0&&(a=-a),Rn.copy(this);let l=1/a,h=1/o,u=1/c;return Rn.elements[0]*=l,Rn.elements[1]*=l,Rn.elements[2]*=l,Rn.elements[4]*=h,Rn.elements[5]*=h,Rn.elements[6]*=h,Rn.elements[8]*=u,Rn.elements[9]*=u,Rn.elements[10]*=u,t.setFromRotationMatrix(Rn),n.x=a,n.y=o,n.z=c,this}makePerspective(e,t,n,s,r,a,o=In,c=!1){let l=this.elements,h=2*r/(t-e),u=2*r/(n-s),d=(t+e)/(t-e),f=(n+s)/(n-s),g,_;if(c)g=r/(a-r),_=a*r/(a-r);else if(o===In)g=-(a+r)/(a-r),_=-2*a*r/(a-r);else if(o===qs)g=-a/(a-r),_=-a*r/(a-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return l[0]=h,l[4]=0,l[8]=d,l[12]=0,l[1]=0,l[5]=u,l[9]=f,l[13]=0,l[2]=0,l[6]=0,l[10]=g,l[14]=_,l[3]=0,l[7]=0,l[11]=-1,l[15]=0,this}makeOrthographic(e,t,n,s,r,a,o=In,c=!1){let l=this.elements,h=2/(t-e),u=2/(n-s),d=-(t+e)/(t-e),f=-(n+s)/(n-s),g,_;if(c)g=1/(a-r),_=a/(a-r);else if(o===In)g=-2/(a-r),_=-(a+r)/(a-r);else if(o===qs)g=-1/(a-r),_=-r/(a-r);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return l[0]=h,l[4]=0,l[8]=0,l[12]=d,l[1]=0,l[5]=u,l[9]=0,l[13]=f,l[2]=0,l[6]=0,l[10]=g,l[14]=_,l[3]=0,l[7]=0,l[11]=0,l[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let s=0;s<16;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}};No.prototype.isMatrix4=!0;Le=No,Ls=new L,Rn=new Le,y0=new L(0,0,0),w0=new L(1,1,1),Mi=new L,ka=new L,hn=new L,vd=new Le,yd=new ge,Bt=class i{constructor(e=0,t=0,n=0,s=i.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=s}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,s=this._order){return this._x=e,this._y=t,this._z=n,this._order=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){let s=e.elements,r=s[0],a=s[4],o=s[8],c=s[1],l=s[5],h=s[9],u=s[2],d=s[6],f=s[10];switch(t){case"XYZ":this._y=Math.asin(We(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-h,f),this._z=Math.atan2(-a,r)):(this._x=Math.atan2(d,l),this._z=0);break;case"YXZ":this._x=Math.asin(-We(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(o,f),this._z=Math.atan2(c,l)):(this._y=Math.atan2(-u,r),this._z=0);break;case"ZXY":this._x=Math.asin(We(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(-u,f),this._z=Math.atan2(-a,l)):(this._y=0,this._z=Math.atan2(c,r));break;case"ZYX":this._y=Math.asin(-We(u,-1,1)),Math.abs(u)<.9999999?(this._x=Math.atan2(d,f),this._z=Math.atan2(c,r)):(this._x=0,this._z=Math.atan2(-a,l));break;case"YZX":this._z=Math.asin(We(c,-1,1)),Math.abs(c)<.9999999?(this._x=Math.atan2(-h,l),this._y=Math.atan2(-u,r)):(this._x=0,this._y=Math.atan2(o,f));break;case"XZY":this._z=Math.asin(-We(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(d,l),this._y=Math.atan2(o,r)):(this._x=Math.atan2(-h,f),this._y=0);break;default:ye("Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return vd.makeRotationFromQuaternion(e),this.setFromRotationMatrix(vd,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return yd.setFromEuler(this),this.setFromQuaternion(yd,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};Bt.DEFAULT_ORDER="XYZ";Or=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},M0=0,wd=new L,Ps=new ge,ai=new Le,Da=new L,Sr=new L,S0=new L,A0=new ge,Md=new L(1,0,0),Sd=new L(0,1,0),Ad=new L(0,0,1),Ed={type:"added"},E0={type:"removed"},Is={type:"childadded",child:null},Ml={type:"childremoved",child:null},rt=class i extends Fn{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:M0++}),this.uuid=kn(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=i.DEFAULT_UP.clone();let e=new L,t=new Bt,n=new ge,s=new L(1,1,1);function r(){n.setFromEuler(t,!1)}function a(){t.setFromQuaternion(n,void 0,!1)}t._onChange(r),n._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:s},modelViewMatrix:{value:new Le},normalMatrix:{value:new ke}}),this.matrix=new Le,this.matrixWorld=new Le,this.matrixAutoUpdate=i.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=i.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Or,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return Ps.setFromAxisAngle(e,t),this.quaternion.multiply(Ps),this}rotateOnWorldAxis(e,t){return Ps.setFromAxisAngle(e,t),this.quaternion.premultiply(Ps),this}rotateX(e){return this.rotateOnAxis(Md,e)}rotateY(e){return this.rotateOnAxis(Sd,e)}rotateZ(e){return this.rotateOnAxis(Ad,e)}translateOnAxis(e,t){return wd.copy(e).applyQuaternion(this.quaternion),this.position.add(wd.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(Md,e)}translateY(e){return this.translateOnAxis(Sd,e)}translateZ(e){return this.translateOnAxis(Ad,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(ai.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?Da.copy(e):Da.set(e,t,n);let s=this.parent;this.updateWorldMatrix(!0,!1),Sr.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?ai.lookAt(Sr,Da,this.up):ai.lookAt(Da,Sr,this.up),this.quaternion.setFromRotationMatrix(ai),s&&(ai.extractRotation(s.matrixWorld),Ps.setFromRotationMatrix(ai),this.quaternion.premultiply(Ps.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(Te("Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(Ed),Is.child=e,this.dispatchEvent(Is),Is.child=null):Te("Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(E0),Ml.child=e,this.dispatchEvent(Ml),Ml.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),ai.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),ai.multiply(e.parent.matrixWorld)),e.applyMatrix4(ai),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(Ed),Is.child=e,this.dispatchEvent(Is),Is.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,s=this.children.length;n<s;n++){let a=this.children[n].getObjectByProperty(e,t);if(a!==void 0)return a}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);let s=this.children;for(let r=0,a=s.length;r<a;r++)s[r].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Sr,e,S0),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Sr,A0,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let t=e.x,n=e.y,s=e.z,r=this.matrix.elements;r[12]+=t-r[0]*t-r[4]*n-r[8]*s,r[13]+=n-r[1]*t-r[5]*n-r[9]*s,r[14]+=s-r[2]*t-r[6]*n-r[10]*s}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t){let n=this.parent;if(e===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),t===!0){let s=this.children;for(let r=0,a=s.length;r<a;r++)s[r].updateWorldMatrix(!1,!0)}}toJSON(e){let t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let s={};s.uuid=this.uuid,s.type=this.type,this.name!==""&&(s.name=this.name),this.castShadow===!0&&(s.castShadow=!0),this.receiveShadow===!0&&(s.receiveShadow=!0),this.visible===!1&&(s.visible=!1),this.frustumCulled===!1&&(s.frustumCulled=!1),this.renderOrder!==0&&(s.renderOrder=this.renderOrder),this.static!==!1&&(s.static=this.static),Object.keys(this.userData).length>0&&(s.userData=this.userData),s.layers=this.layers.mask,s.matrix=this.matrix.toArray(),s.up=this.up.toArray(),this.pivot!==null&&(s.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(s.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(s.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(s.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(s.type="InstancedMesh",s.count=this.count,s.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(s.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(s.type="BatchedMesh",s.perObjectFrustumCulled=this.perObjectFrustumCulled,s.sortObjects=this.sortObjects,s.drawRanges=this._drawRanges,s.reservedRanges=this._reservedRanges,s.geometryInfo=this._geometryInfo.map(o=>({...o,boundingBox:o.boundingBox?o.boundingBox.toJSON():void 0,boundingSphere:o.boundingSphere?o.boundingSphere.toJSON():void 0})),s.instanceInfo=this._instanceInfo.map(o=>({...o})),s.availableInstanceIds=this._availableInstanceIds.slice(),s.availableGeometryIds=this._availableGeometryIds.slice(),s.nextIndexStart=this._nextIndexStart,s.nextVertexStart=this._nextVertexStart,s.geometryCount=this._geometryCount,s.maxInstanceCount=this._maxInstanceCount,s.maxVertexCount=this._maxVertexCount,s.maxIndexCount=this._maxIndexCount,s.geometryInitialized=this._geometryInitialized,s.matricesTexture=this._matricesTexture.toJSON(e),s.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(s.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(s.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(s.boundingBox=this.boundingBox.toJSON()));function r(o,c){return o[c.uuid]===void 0&&(o[c.uuid]=c.toJSON(e)),c.uuid}if(this.isScene)this.background&&(this.background.isColor?s.background=this.background.toJSON():this.background.isTexture&&(s.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(s.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){s.geometry=r(e.geometries,this.geometry);let o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){let c=o.shapes;if(Array.isArray(c))for(let l=0,h=c.length;l<h;l++){let u=c[l];r(e.shapes,u)}else r(e.shapes,c)}}if(this.isSkinnedMesh&&(s.bindMode=this.bindMode,s.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(e.skeletons,this.skeleton),s.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let o=[];for(let c=0,l=this.material.length;c<l;c++)o.push(r(e.materials,this.material[c]));s.material=o}else s.material=r(e.materials,this.material);if(this.children.length>0){s.children=[];for(let o=0;o<this.children.length;o++)s.children.push(this.children[o].toJSON(e).object)}if(this.animations.length>0){s.animations=[];for(let o=0;o<this.animations.length;o++){let c=this.animations[o];s.animations.push(r(e.animations,c))}}if(t){let o=a(e.geometries),c=a(e.materials),l=a(e.textures),h=a(e.images),u=a(e.shapes),d=a(e.skeletons),f=a(e.animations),g=a(e.nodes);o.length>0&&(n.geometries=o),c.length>0&&(n.materials=c),l.length>0&&(n.textures=l),h.length>0&&(n.images=h),u.length>0&&(n.shapes=u),d.length>0&&(n.skeletons=d),f.length>0&&(n.animations=f),g.length>0&&(n.nodes=g)}return n.object=s,n;function a(o){let c=[];for(let l in o){let h=o[l];delete h.metadata,c.push(h)}return c}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot!==null?e.pivot.clone():null,this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){let s=e.children[n];this.add(s.clone())}return this}};rt.DEFAULT_UP=new L(0,1,0);rt.DEFAULT_MATRIX_AUTO_UPDATE=!0;rt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;Nt=class extends rt{constructor(){super(),this.isGroup=!0,this.type="Group"}},T0={type:"move"},Ks=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Nt,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Nt,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new L,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new L),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Nt,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new L,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new L,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let t=this._hand;if(t)for(let n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let s=null,r=null,a=null,o=this._targetRay,c=this._grip,l=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(l&&e.hand){a=!0;for(let _ of e.hand.values()){let m=t.getJointPose(_,n),p=this._getHandJoint(l,_);m!==null&&(p.matrix.fromArray(m.transform.matrix),p.matrix.decompose(p.position,p.rotation,p.scale),p.matrixWorldNeedsUpdate=!0,p.jointRadius=m.radius),p.visible=m!==null}let h=l.joints["index-finger-tip"],u=l.joints["thumb-tip"],d=h.position.distanceTo(u.position),f=.02,g=.005;l.inputState.pinching&&d>f+g?(l.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!l.inputState.pinching&&d<=f-g&&(l.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else c!==null&&e.gripSpace&&(r=t.getPose(e.gripSpace,n),r!==null&&(c.matrix.fromArray(r.transform.matrix),c.matrix.decompose(c.position,c.rotation,c.scale),c.matrixWorldNeedsUpdate=!0,r.linearVelocity?(c.hasLinearVelocity=!0,c.linearVelocity.copy(r.linearVelocity)):c.hasLinearVelocity=!1,r.angularVelocity?(c.hasAngularVelocity=!0,c.angularVelocity.copy(r.angularVelocity)):c.hasAngularVelocity=!1,c.eventsEnabled&&c.dispatchEvent({type:"gripUpdated",data:e,target:this})));o!==null&&(s=t.getPose(e.targetRaySpace,n),s===null&&r!==null&&(s=r),s!==null&&(o.matrix.fromArray(s.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,s.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(s.linearVelocity)):o.hasLinearVelocity=!1,s.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(s.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(T0)))}return o!==null&&(o.visible=s!==null),c!==null&&(c.visible=r!==null),l!==null&&(l.visible=a!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){let n=new Nt;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}},Ff={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Si={h:0,s:0,l:0},Fa={h:0,s:0,l:0};Ee=class{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){let s=e;s&&s.isColor?this.copy(s):typeof s=="number"?this.setHex(s):typeof s=="string"&&this.setStyle(s)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=Pt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,ze.colorSpaceToWorking(this,t),this}setRGB(e,t,n,s=ze.workingColorSpace){return this.r=e,this.g=t,this.b=n,ze.colorSpaceToWorking(this,s),this}setHSL(e,t,n,s=ze.workingColorSpace){if(e=Mh(e,1),t=We(t,0,1),n=We(n,0,1),t===0)this.r=this.g=this.b=n;else{let r=n<=.5?n*(1+t):n+t-n*t,a=2*n-r;this.r=Sl(a,r,e+1/3),this.g=Sl(a,r,e),this.b=Sl(a,r,e-1/3)}return ze.colorSpaceToWorking(this,s),this}setStyle(e,t=Pt){function n(r){r!==void 0&&parseFloat(r)<1&&ye("Color: Alpha component of "+e+" will be ignored.")}let s;if(s=/^(\w+)\(([^\)]*)\)/.exec(e)){let r,a=s[1],o=s[2];switch(a){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,t);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,t);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,t);break;default:ye("Color: Unknown color model "+e)}}else if(s=/^\#([A-Fa-f\d]+)$/.exec(e)){let r=s[1],a=r.length;if(a===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,t);if(a===6)return this.setHex(parseInt(r,16),t);ye("Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=Pt){let n=Ff[e.toLowerCase()];return n!==void 0?this.setHex(n,t):ye("Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=di(e.r),this.g=di(e.g),this.b=di(e.b),this}copyLinearToSRGB(e){return this.r=Gs(e.r),this.g=Gs(e.g),this.b=Gs(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=Pt){return ze.workingToColorSpace(qt.copy(this),e),Math.round(We(qt.r*255,0,255))*65536+Math.round(We(qt.g*255,0,255))*256+Math.round(We(qt.b*255,0,255))}getHexString(e=Pt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=ze.workingColorSpace){ze.workingToColorSpace(qt.copy(this),t);let n=qt.r,s=qt.g,r=qt.b,a=Math.max(n,s,r),o=Math.min(n,s,r),c,l,h=(o+a)/2;if(o===a)c=0,l=0;else{let u=a-o;switch(l=h<=.5?u/(a+o):u/(2-a-o),a){case n:c=(s-r)/u+(s<r?6:0);break;case s:c=(r-n)/u+2;break;case r:c=(n-s)/u+4;break}c/=6}return e.h=c,e.s=l,e.l=h,e}getRGB(e,t=ze.workingColorSpace){return ze.workingToColorSpace(qt.copy(this),t),e.r=qt.r,e.g=qt.g,e.b=qt.b,e}getStyle(e=Pt){ze.workingToColorSpace(qt.copy(this),e);let t=qt.r,n=qt.g,s=qt.b;return e!==Pt?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${s.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(s*255)})`}offsetHSL(e,t,n){return this.getHSL(Si),this.setHSL(Si.h+e,Si.s+t,Si.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(Si),e.getHSL(Fa);let n=kr(Si.h,Fa.h,t),s=kr(Si.s,Fa.s,t),r=kr(Si.l,Fa.l,t);return this.setHSL(n,s,r),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,n=this.g,s=this.b,r=e.elements;return this.r=r[0]*t+r[3]*n+r[6]*s,this.g=r[1]*t+r[4]*n+r[7]*s,this.b=r[2]*t+r[5]*n+r[8]*s,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},qt=new Ee;Ee.NAMES=Ff;Ii=class extends rt{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Bt,this.environmentIntensity=1,this.environmentRotation=new Bt,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}},Cn=new L,oi=new L,Al=new L,ci=new L,ks=new L,Ds=new L,Td=new L,El=new L,Tl=new L,Rl=new L,Cl=new st,Ll=new st,Pl=new st,Ci=class i{constructor(e=new L,t=new L,n=new L){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,s){s.subVectors(n,t),Cn.subVectors(e,t),s.cross(Cn);let r=s.lengthSq();return r>0?s.multiplyScalar(1/Math.sqrt(r)):s.set(0,0,0)}static getBarycoord(e,t,n,s,r){Cn.subVectors(s,t),oi.subVectors(n,t),Al.subVectors(e,t);let a=Cn.dot(Cn),o=Cn.dot(oi),c=Cn.dot(Al),l=oi.dot(oi),h=oi.dot(Al),u=a*l-o*o;if(u===0)return r.set(0,0,0),null;let d=1/u,f=(l*c-o*h)*d,g=(a*h-o*c)*d;return r.set(1-f-g,g,f)}static containsPoint(e,t,n,s){return this.getBarycoord(e,t,n,s,ci)===null?!1:ci.x>=0&&ci.y>=0&&ci.x+ci.y<=1}static getInterpolation(e,t,n,s,r,a,o,c){return this.getBarycoord(e,t,n,s,ci)===null?(c.x=0,c.y=0,"z"in c&&(c.z=0),"w"in c&&(c.w=0),null):(c.setScalar(0),c.addScaledVector(r,ci.x),c.addScaledVector(a,ci.y),c.addScaledVector(o,ci.z),c)}static getInterpolatedAttribute(e,t,n,s,r,a){return Cl.setScalar(0),Ll.setScalar(0),Pl.setScalar(0),Cl.fromBufferAttribute(e,t),Ll.fromBufferAttribute(e,n),Pl.fromBufferAttribute(e,s),a.setScalar(0),a.addScaledVector(Cl,r.x),a.addScaledVector(Ll,r.y),a.addScaledVector(Pl,r.z),a}static isFrontFacing(e,t,n,s){return Cn.subVectors(n,t),oi.subVectors(e,t),Cn.cross(oi).dot(s)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,s){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[s]),this}setFromAttributeAndIndices(e,t,n,s){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,s),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return Cn.subVectors(this.c,this.b),oi.subVectors(this.a,this.b),Cn.cross(oi).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return i.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return i.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,n,s,r){return i.getInterpolation(e,this.a,this.b,this.c,t,n,s,r)}containsPoint(e){return i.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return i.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){let n=this.a,s=this.b,r=this.c,a,o;ks.subVectors(s,n),Ds.subVectors(r,n),El.subVectors(e,n);let c=ks.dot(El),l=Ds.dot(El);if(c<=0&&l<=0)return t.copy(n);Tl.subVectors(e,s);let h=ks.dot(Tl),u=Ds.dot(Tl);if(h>=0&&u<=h)return t.copy(s);let d=c*u-h*l;if(d<=0&&c>=0&&h<=0)return a=c/(c-h),t.copy(n).addScaledVector(ks,a);Rl.subVectors(e,r);let f=ks.dot(Rl),g=Ds.dot(Rl);if(g>=0&&f<=g)return t.copy(r);let _=f*l-c*g;if(_<=0&&l>=0&&g<=0)return o=l/(l-g),t.copy(n).addScaledVector(Ds,o);let m=h*g-f*u;if(m<=0&&u-h>=0&&f-g>=0)return Td.subVectors(r,s),o=(u-h)/(u-h+(f-g)),t.copy(s).addScaledVector(Td,o);let p=1/(m+_+d);return a=_*p,o=d*p,t.copy(n).addScaledVector(ks,a).addScaledVector(Ds,o)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},Tt=class{constructor(e=new L(1/0,1/0,1/0),t=new L(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(Ln.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(Ln.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let n=Ln.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let n=e.geometry;if(n!==void 0){let r=n.getAttribute("position");if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let a=0,o=r.count;a<o;a++)e.isMesh===!0?e.getVertexPosition(a,Ln):Ln.fromBufferAttribute(r,a),Ln.applyMatrix4(e.matrixWorld),this.expandByPoint(Ln);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),Na.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),Na.copy(n.boundingBox)),Na.applyMatrix4(e.matrixWorld),this.union(Na)}let s=e.children;for(let r=0,a=s.length;r<a;r++)this.expandByObject(s[r],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,Ln),Ln.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(Ar),Ua.subVectors(this.max,Ar),Fs.subVectors(e.a,Ar),Ns.subVectors(e.b,Ar),Us.subVectors(e.c,Ar),Ai.subVectors(Ns,Fs),Ei.subVectors(Us,Ns),ji.subVectors(Fs,Us);let t=[0,-Ai.z,Ai.y,0,-Ei.z,Ei.y,0,-ji.z,ji.y,Ai.z,0,-Ai.x,Ei.z,0,-Ei.x,ji.z,0,-ji.x,-Ai.y,Ai.x,0,-Ei.y,Ei.x,0,-ji.y,ji.x,0];return!Il(t,Fs,Ns,Us,Ua)||(t=[1,0,0,0,1,0,0,0,1],!Il(t,Fs,Ns,Us,Ua))?!1:(Oa.crossVectors(Ai,Ei),t=[Oa.x,Oa.y,Oa.z],Il(t,Fs,Ns,Us,Ua))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,Ln).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(Ln).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(li[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),li[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),li[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),li[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),li[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),li[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),li[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),li[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(li),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},li=[new L,new L,new L,new L,new L,new L,new L,new L],Ln=new L,Na=new Tt,Fs=new L,Ns=new L,Us=new L,Ai=new L,Ei=new L,ji=new L,Ar=new L,Ua=new L,Oa=new L,Yi=new L;St=new L,Ba=new Ie,R0=0,Et=class extends Fn{constructor(e,t,n=!1){if(super(),Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:R0++}),this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=mo,this.updateRanges=[],this.gpuType=mn,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let s=0,r=this.itemSize;s<r;s++)this.array[e+s]=t.array[n+s];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)Ba.fromBufferAttribute(this,t),Ba.applyMatrix3(e),this.setXY(t,Ba.x,Ba.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)St.fromBufferAttribute(this,t),St.applyMatrix3(e),this.setXYZ(t,St.x,St.y,St.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)St.fromBufferAttribute(this,t),St.applyMatrix4(e),this.setXYZ(t,St.x,St.y,St.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)St.fromBufferAttribute(this,t),St.applyNormalMatrix(e),this.setXYZ(t,St.x,St.y,St.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)St.fromBufferAttribute(this,t),St.transformDirection(e),this.setXYZ(t,St.x,St.y,St.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=Pn(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=Ze(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=Pn(t,this.array)),t}setX(e,t){return this.normalized&&(t=Ze(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=Pn(t,this.array)),t}setY(e,t){return this.normalized&&(t=Ze(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=Pn(t,this.array)),t}setZ(e,t){return this.normalized&&(t=Ze(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=Pn(t,this.array)),t}setW(e,t){return this.normalized&&(t=Ze(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=Ze(t,this.array),n=Ze(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,s){return e*=this.itemSize,this.normalized&&(t=Ze(t,this.array),n=Ze(n,this.array),s=Ze(s,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e*=this.itemSize,this.normalized&&(t=Ze(t,this.array),n=Ze(n,this.array),s=Ze(s,this.array),r=Ze(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this.array[e+3]=r,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==mo&&(e.usage=this.usage),e}dispose(){this.dispatchEvent({type:"dispose"})}},Br=class extends Et{constructor(e,t,n){super(new Uint16Array(e),t,n)}},Hr=class extends Et{constructor(e,t,n){super(new Uint32Array(e),t,n)}},Ut=class extends Et{constructor(e,t,n){super(new Float32Array(e),t,n)}},C0=new Tt,Er=new L,kl=new L,en=class{constructor(e=new L,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let n=this.center;t!==void 0?n.copy(t):C0.setFromPoints(e).getCenter(n);let s=0;for(let r=0,a=e.length;r<a;r++)s=Math.max(s,n.distanceToSquared(e[r]));return this.radius=Math.sqrt(s),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Er.subVectors(e,this.center);let t=Er.lengthSq();if(t>this.radius*this.radius){let n=Math.sqrt(t),s=(n-this.radius)*.5;this.center.addScaledVector(Er,s/n),this.radius+=s}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(kl.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Er.copy(e.center).add(kl)),this.expandByPoint(Er.copy(e.center).sub(kl))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},L0=0,yn=new Le,Dl=new rt,Os=new L,un=new Tt,Tr=new Tt,Ft=new L,Xt=class i extends Fn{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:L0++}),this.uuid=kn(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(t0(e)?Hr:Br)(e,1):this.index=e,this}setIndirect(e,t=0){return this.indirect=e,this.indirectOffset=t,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){let t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let r=new ke().getNormalMatrix(e);n.applyNormalMatrix(r),n.needsUpdate=!0}let s=this.attributes.tangent;return s!==void 0&&(s.transformDirection(e),s.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return yn.makeRotationFromQuaternion(e),this.applyMatrix4(yn),this}rotateX(e){return yn.makeRotationX(e),this.applyMatrix4(yn),this}rotateY(e){return yn.makeRotationY(e),this.applyMatrix4(yn),this}rotateZ(e){return yn.makeRotationZ(e),this.applyMatrix4(yn),this}translate(e,t,n){return yn.makeTranslation(e,t,n),this.applyMatrix4(yn),this}scale(e,t,n){return yn.makeScale(e,t,n),this.applyMatrix4(yn),this}lookAt(e){return Dl.lookAt(e),Dl.updateMatrix(),this.applyMatrix4(Dl.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Os).negate(),this.translate(Os.x,Os.y,Os.z),this}setFromPoints(e){let t=this.getAttribute("position");if(t===void 0){let n=[];for(let s=0,r=e.length;s<r;s++){let a=e[s];n.push(a.x,a.y,a.z||0)}this.setAttribute("position",new Ut(n,3))}else{let n=Math.min(e.length,t.count);for(let s=0;s<n;s++){let r=e[s];t.setXYZ(s,r.x,r.y,r.z||0)}e.length>t.count&&ye("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Tt);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Te("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new L(-1/0,-1/0,-1/0),new L(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,s=t.length;n<s;n++){let r=t[n];un.setFromBufferAttribute(r),this.morphTargetsRelative?(Ft.addVectors(this.boundingBox.min,un.min),this.boundingBox.expandByPoint(Ft),Ft.addVectors(this.boundingBox.max,un.max),this.boundingBox.expandByPoint(Ft)):(this.boundingBox.expandByPoint(un.min),this.boundingBox.expandByPoint(un.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&Te('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new en);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Te("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new L,1/0);return}if(e){let n=this.boundingSphere.center;if(un.setFromBufferAttribute(e),t)for(let r=0,a=t.length;r<a;r++){let o=t[r];Tr.setFromBufferAttribute(o),this.morphTargetsRelative?(Ft.addVectors(un.min,Tr.min),un.expandByPoint(Ft),Ft.addVectors(un.max,Tr.max),un.expandByPoint(Ft)):(un.expandByPoint(Tr.min),un.expandByPoint(Tr.max))}un.getCenter(n);let s=0;for(let r=0,a=e.count;r<a;r++)Ft.fromBufferAttribute(e,r),s=Math.max(s,n.distanceToSquared(Ft));if(t)for(let r=0,a=t.length;r<a;r++){let o=t[r],c=this.morphTargetsRelative;for(let l=0,h=o.count;l<h;l++)Ft.fromBufferAttribute(o,l),c&&(Os.fromBufferAttribute(e,l),Ft.add(Os)),s=Math.max(s,n.distanceToSquared(Ft))}this.boundingSphere.radius=Math.sqrt(s),isNaN(this.boundingSphere.radius)&&Te('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){Te("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let n=t.position,s=t.normal,r=t.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Et(new Float32Array(4*n.count),4));let a=this.getAttribute("tangent"),o=[],c=[];for(let b=0;b<n.count;b++)o[b]=new L,c[b]=new L;let l=new L,h=new L,u=new L,d=new Ie,f=new Ie,g=new Ie,_=new L,m=new L;function p(b,T,P){l.fromBufferAttribute(n,b),h.fromBufferAttribute(n,T),u.fromBufferAttribute(n,P),d.fromBufferAttribute(r,b),f.fromBufferAttribute(r,T),g.fromBufferAttribute(r,P),h.sub(l),u.sub(l),f.sub(d),g.sub(d);let C=1/(f.x*g.y-g.x*f.y);isFinite(C)&&(_.copy(h).multiplyScalar(g.y).addScaledVector(u,-f.y).multiplyScalar(C),m.copy(u).multiplyScalar(f.x).addScaledVector(h,-g.x).multiplyScalar(C),o[b].add(_),o[T].add(_),o[P].add(_),c[b].add(m),c[T].add(m),c[P].add(m))}let x=this.groups;x.length===0&&(x=[{start:0,count:e.count}]);for(let b=0,T=x.length;b<T;++b){let P=x[b],C=P.start,N=P.count;for(let G=C,q=C+N;G<q;G+=3)p(e.getX(G+0),e.getX(G+1),e.getX(G+2))}let y=new L,w=new L,A=new L,S=new L;function R(b){A.fromBufferAttribute(s,b),S.copy(A);let T=o[b];y.copy(T),y.sub(A.multiplyScalar(A.dot(T))).normalize(),w.crossVectors(S,T);let C=w.dot(c[b])<0?-1:1;a.setXYZW(b,y.x,y.y,y.z,C)}for(let b=0,T=x.length;b<T;++b){let P=x[b],C=P.start,N=P.count;for(let G=C,q=C+N;G<q;G+=3)R(e.getX(G+0)),R(e.getX(G+1)),R(e.getX(G+2))}}computeVertexNormals(){let e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new Et(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let d=0,f=n.count;d<f;d++)n.setXYZ(d,0,0,0);let s=new L,r=new L,a=new L,o=new L,c=new L,l=new L,h=new L,u=new L;if(e)for(let d=0,f=e.count;d<f;d+=3){let g=e.getX(d+0),_=e.getX(d+1),m=e.getX(d+2);s.fromBufferAttribute(t,g),r.fromBufferAttribute(t,_),a.fromBufferAttribute(t,m),h.subVectors(a,r),u.subVectors(s,r),h.cross(u),o.fromBufferAttribute(n,g),c.fromBufferAttribute(n,_),l.fromBufferAttribute(n,m),o.add(h),c.add(h),l.add(h),n.setXYZ(g,o.x,o.y,o.z),n.setXYZ(_,c.x,c.y,c.z),n.setXYZ(m,l.x,l.y,l.z)}else for(let d=0,f=t.count;d<f;d+=3)s.fromBufferAttribute(t,d+0),r.fromBufferAttribute(t,d+1),a.fromBufferAttribute(t,d+2),h.subVectors(a,r),u.subVectors(s,r),h.cross(u),n.setXYZ(d+0,h.x,h.y,h.z),n.setXYZ(d+1,h.x,h.y,h.z),n.setXYZ(d+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)Ft.fromBufferAttribute(e,t),Ft.normalize(),e.setXYZ(t,Ft.x,Ft.y,Ft.z)}toNonIndexed(){function e(o,c){let l=o.array,h=o.itemSize,u=o.normalized,d=new l.constructor(c.length*h),f=0,g=0;for(let _=0,m=c.length;_<m;_++){o.isInterleavedBufferAttribute?f=c[_]*o.data.stride+o.offset:f=c[_]*h;for(let p=0;p<h;p++)d[g++]=l[f++]}return new Et(d,h,u)}if(this.index===null)return ye("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let t=new i,n=this.index.array,s=this.attributes;for(let o in s){let c=s[o],l=e(c,n);t.setAttribute(o,l)}let r=this.morphAttributes;for(let o in r){let c=[],l=r[o];for(let h=0,u=l.length;h<u;h++){let d=l[h],f=e(d,n);c.push(f)}t.morphAttributes[o]=c}t.morphTargetsRelative=this.morphTargetsRelative;let a=this.groups;for(let o=0,c=a.length;o<c;o++){let l=a[o];t.addGroup(l.start,l.count,l.materialIndex)}return t}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let c=this.parameters;for(let l in c)c[l]!==void 0&&(e[l]=c[l]);return e}e.data={attributes:{}};let t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});let n=this.attributes;for(let c in n){let l=n[c];e.data.attributes[c]=l.toJSON(e.data)}let s={},r=!1;for(let c in this.morphAttributes){let l=this.morphAttributes[c],h=[];for(let u=0,d=l.length;u<d;u++){let f=l[u];h.push(f.toJSON(e.data))}h.length>0&&(s[c]=h,r=!0)}r&&(e.data.morphAttributes=s,e.data.morphTargetsRelative=this.morphTargetsRelative);let a=this.groups;a.length>0&&(e.data.groups=JSON.parse(JSON.stringify(a)));let o=this.boundingSphere;return o!==null&&(e.data.boundingSphere=o.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let t={};this.name=e.name;let n=e.index;n!==null&&this.setIndex(n.clone());let s=e.attributes;for(let l in s){let h=s[l];this.setAttribute(l,h.clone(t))}let r=e.morphAttributes;for(let l in r){let h=[],u=r[l];for(let d=0,f=u.length;d<f;d++)h.push(u[d].clone(t));this.morphAttributes[l]=h}this.morphTargetsRelative=e.morphTargetsRelative;let a=e.groups;for(let l=0,h=a.length;l<h;l++){let u=a[l];this.addGroup(u.start,u.count,u.materialIndex)}let o=e.boundingBox;o!==null&&(this.boundingBox=o.clone());let c=e.boundingSphere;return c!==null&&(this.boundingSphere=c.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}},Js=class{constructor(e,t){this.isInterleavedBuffer=!0,this.array=e,this.stride=t,this.count=e!==void 0?e.length/t:0,this.usage=mo,this.updateRanges=[],this.version=0,this.uuid=kn()}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.array=new e.array.constructor(e.array),this.count=e.count,this.stride=e.stride,this.usage=e.usage,this}copyAt(e,t,n){e*=this.stride,n*=t.stride;for(let s=0,r=this.stride;s<r;s++)this.array[e+s]=t.array[n+s];return this}set(e,t=0){return this.array.set(e,t),this}clone(e){e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=kn()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);let t=new this.array.constructor(e.arrayBuffers[this.array.buffer._uuid]),n=new this.constructor(t,this.stride);return n.setUsage(this.usage),n}onUpload(e){return this.onUploadCallback=e,this}toJSON(e){return e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=kn()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer))),{uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride}}},Kt=new L,$s=class i{constructor(e,t,n,s=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=e,this.itemSize=t,this.offset=n,this.normalized=s}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(e){this.data.needsUpdate=e}applyMatrix4(e){for(let t=0,n=this.data.count;t<n;t++)Kt.fromBufferAttribute(this,t),Kt.applyMatrix4(e),this.setXYZ(t,Kt.x,Kt.y,Kt.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)Kt.fromBufferAttribute(this,t),Kt.applyNormalMatrix(e),this.setXYZ(t,Kt.x,Kt.y,Kt.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)Kt.fromBufferAttribute(this,t),Kt.transformDirection(e),this.setXYZ(t,Kt.x,Kt.y,Kt.z);return this}getComponent(e,t){let n=this.array[e*this.data.stride+this.offset+t];return this.normalized&&(n=Pn(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=Ze(n,this.array)),this.data.array[e*this.data.stride+this.offset+t]=n,this}setX(e,t){return this.normalized&&(t=Ze(t,this.array)),this.data.array[e*this.data.stride+this.offset]=t,this}setY(e,t){return this.normalized&&(t=Ze(t,this.array)),this.data.array[e*this.data.stride+this.offset+1]=t,this}setZ(e,t){return this.normalized&&(t=Ze(t,this.array)),this.data.array[e*this.data.stride+this.offset+2]=t,this}setW(e,t){return this.normalized&&(t=Ze(t,this.array)),this.data.array[e*this.data.stride+this.offset+3]=t,this}getX(e){let t=this.data.array[e*this.data.stride+this.offset];return this.normalized&&(t=Pn(t,this.array)),t}getY(e){let t=this.data.array[e*this.data.stride+this.offset+1];return this.normalized&&(t=Pn(t,this.array)),t}getZ(e){let t=this.data.array[e*this.data.stride+this.offset+2];return this.normalized&&(t=Pn(t,this.array)),t}getW(e){let t=this.data.array[e*this.data.stride+this.offset+3];return this.normalized&&(t=Pn(t,this.array)),t}setXY(e,t,n){return e=e*this.data.stride+this.offset,this.normalized&&(t=Ze(t,this.array),n=Ze(n,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this}setXYZ(e,t,n,s){return e=e*this.data.stride+this.offset,this.normalized&&(t=Ze(t,this.array),n=Ze(n,this.array),s=Ze(s,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e=e*this.data.stride+this.offset,this.normalized&&(t=Ze(t,this.array),n=Ze(n,this.array),s=Ze(s,this.array),r=Ze(r,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=s,this.data.array[e+3]=r,this}clone(e){if(e===void 0){Nr("InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");let t=[];for(let n=0;n<this.count;n++){let s=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)t.push(this.data.array[s+r])}return new Et(new this.array.constructor(t),this.itemSize,this.normalized)}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.clone(e)),new i(e.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(e){if(e===void 0){Nr("InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");let t=[];for(let n=0;n<this.count;n++){let s=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)t.push(this.data.array[s+r])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:t,normalized:this.normalized}}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.toJSON(e)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}},P0=0,tn=class extends Fn{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:P0++}),this.uuid=kn(),this.name="",this.type="Material",this.blending=ts,this.side=Dn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=ro,this.blendDst=ao,this.blendEquation=Li,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Ee(0,0,0),this.blendAlpha=0,this.depthFunc=ns,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=jl,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=$i,this.stencilZFail=$i,this.stencilZPass=$i,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let n=e[t];if(n===void 0){ye(`Material: parameter '${t}' has value of undefined.`);continue}let s=this[t];if(s===void 0){ye(`Material: '${t}' is not a property of THREE.${this.type}.`);continue}s&&s.isColor?s.set(n):s&&s.isVector3&&n&&n.isVector3?s.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});let n={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(n.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(n.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==ts&&(n.blending=this.blending),this.side!==Dn&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==ro&&(n.blendSrc=this.blendSrc),this.blendDst!==ao&&(n.blendDst=this.blendDst),this.blendEquation!==Li&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==ns&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==jl&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==$i&&(n.stencilFail=this.stencilFail),this.stencilZFail!==$i&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==$i&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.allowOverride===!1&&(n.allowOverride=!1),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function s(r){let a=[];for(let o in r){let c=r[o];delete c.metadata,a.push(c)}return a}if(t){let r=s(e.textures),a=s(e.images);r.length>0&&(n.textures=r),a.length>0&&(n.images=a)}return n}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,n=null;if(t!==null){let s=t.length;n=new Array(s);for(let r=0;r!==s;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}},hi=new L,Fl=new L,Ha=new L,Ti=new L,Nl=new L,za=new L,Ul=new L,as=class{constructor(e=new L,t=new L(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,hi)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=hi.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(hi.copy(this.origin).addScaledVector(this.direction,t),hi.distanceToSquared(e))}distanceSqToSegment(e,t,n,s){Fl.copy(e).add(t).multiplyScalar(.5),Ha.copy(t).sub(e).normalize(),Ti.copy(this.origin).sub(Fl);let r=e.distanceTo(t)*.5,a=-this.direction.dot(Ha),o=Ti.dot(this.direction),c=-Ti.dot(Ha),l=Ti.lengthSq(),h=Math.abs(1-a*a),u,d,f,g;if(h>0)if(u=a*c-o,d=a*o-c,g=r*h,u>=0)if(d>=-g)if(d<=g){let _=1/h;u*=_,d*=_,f=u*(u+a*d+2*o)+d*(a*u+d+2*c)+l}else d=r,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*c)+l;else d=-r,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*c)+l;else d<=-g?(u=Math.max(0,-(-a*r+o)),d=u>0?-r:Math.min(Math.max(-r,-c),r),f=-u*u+d*(d+2*c)+l):d<=g?(u=0,d=Math.min(Math.max(-r,-c),r),f=d*(d+2*c)+l):(u=Math.max(0,-(a*r+o)),d=u>0?r:Math.min(Math.max(-r,-c),r),f=-u*u+d*(d+2*c)+l);else d=a>0?-r:r,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*c)+l;return n&&n.copy(this.origin).addScaledVector(this.direction,u),s&&s.copy(Fl).addScaledVector(Ha,d),f}intersectSphere(e,t){hi.subVectors(e.center,this.origin);let n=hi.dot(this.direction),s=hi.dot(hi)-n*n,r=e.radius*e.radius;if(s>r)return null;let a=Math.sqrt(r-s),o=n-a,c=n+a;return c<0?null:o<0?this.at(c,t):this.at(o,t)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){let n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,s,r,a,o,c,l=1/this.direction.x,h=1/this.direction.y,u=1/this.direction.z,d=this.origin;return l>=0?(n=(e.min.x-d.x)*l,s=(e.max.x-d.x)*l):(n=(e.max.x-d.x)*l,s=(e.min.x-d.x)*l),h>=0?(r=(e.min.y-d.y)*h,a=(e.max.y-d.y)*h):(r=(e.max.y-d.y)*h,a=(e.min.y-d.y)*h),n>a||r>s||((r>n||isNaN(n))&&(n=r),(a<s||isNaN(s))&&(s=a),u>=0?(o=(e.min.z-d.z)*u,c=(e.max.z-d.z)*u):(o=(e.max.z-d.z)*u,c=(e.min.z-d.z)*u),n>c||o>s)||((o>n||n!==n)&&(n=o),(c<s||s!==s)&&(s=c),s<0)?null:this.at(n>=0?n:s,t)}intersectsBox(e){return this.intersectBox(e,hi)!==null}intersectTriangle(e,t,n,s,r){Nl.subVectors(t,e),za.subVectors(n,e),Ul.crossVectors(Nl,za);let a=this.direction.dot(Ul),o;if(a>0){if(s)return null;o=1}else if(a<0)o=-1,a=-a;else return null;Ti.subVectors(this.origin,e);let c=o*this.direction.dot(za.crossVectors(Ti,za));if(c<0)return null;let l=o*this.direction.dot(Nl.cross(Ti));if(l<0||c+l>a)return null;let h=-o*Ti.dot(Ul);return h<0?null:this.at(h/a,r)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},fn=class extends tn{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Ee(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Bt,this.combine=ah,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},Rd=new Le,Ki=new as,Va=new en,Cd=new L,Ga=new L,Wa=new L,qa=new L,Ol=new L,Xa=new L,Ld=new L,ja=new L,It=class extends rt{constructor(e=new Xt,t=new fn){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=s.length;r<a;r++){let o=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}getVertexPosition(e,t){let n=this.geometry,s=n.attributes.position,r=n.morphAttributes.position,a=n.morphTargetsRelative;t.fromBufferAttribute(s,e);let o=this.morphTargetInfluences;if(r&&o){Xa.set(0,0,0);for(let c=0,l=r.length;c<l;c++){let h=o[c],u=r[c];h!==0&&(Ol.fromBufferAttribute(u,e),a?Xa.addScaledVector(Ol,h):Xa.addScaledVector(Ol.sub(t),h))}t.add(Xa)}return t}raycast(e,t){let n=this.geometry,s=this.material,r=this.matrixWorld;s!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),Va.copy(n.boundingSphere),Va.applyMatrix4(r),Ki.copy(e.ray).recast(e.near),!(Va.containsPoint(Ki.origin)===!1&&(Ki.intersectSphere(Va,Cd)===null||Ki.origin.distanceToSquared(Cd)>(e.far-e.near)**2))&&(Rd.copy(r).invert(),Ki.copy(e.ray).applyMatrix4(Rd),!(n.boundingBox!==null&&Ki.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,Ki)))}_computeIntersections(e,t,n){let s,r=this.geometry,a=this.material,o=r.index,c=r.attributes.position,l=r.attributes.uv,h=r.attributes.uv1,u=r.attributes.normal,d=r.groups,f=r.drawRange;if(o!==null)if(Array.isArray(a))for(let g=0,_=d.length;g<_;g++){let m=d[g],p=a[m.materialIndex],x=Math.max(m.start,f.start),y=Math.min(o.count,Math.min(m.start+m.count,f.start+f.count));for(let w=x,A=y;w<A;w+=3){let S=o.getX(w),R=o.getX(w+1),b=o.getX(w+2);s=Ya(this,p,e,n,l,h,u,S,R,b),s&&(s.faceIndex=Math.floor(w/3),s.face.materialIndex=m.materialIndex,t.push(s))}}else{let g=Math.max(0,f.start),_=Math.min(o.count,f.start+f.count);for(let m=g,p=_;m<p;m+=3){let x=o.getX(m),y=o.getX(m+1),w=o.getX(m+2);s=Ya(this,a,e,n,l,h,u,x,y,w),s&&(s.faceIndex=Math.floor(m/3),t.push(s))}}else if(c!==void 0)if(Array.isArray(a))for(let g=0,_=d.length;g<_;g++){let m=d[g],p=a[m.materialIndex],x=Math.max(m.start,f.start),y=Math.min(c.count,Math.min(m.start+m.count,f.start+f.count));for(let w=x,A=y;w<A;w+=3){let S=w,R=w+1,b=w+2;s=Ya(this,p,e,n,l,h,u,S,R,b),s&&(s.faceIndex=Math.floor(w/3),s.face.materialIndex=m.materialIndex,t.push(s))}}else{let g=Math.max(0,f.start),_=Math.min(c.count,f.start+f.count);for(let m=g,p=_;m<p;m+=3){let x=m,y=m+1,w=m+2;s=Ya(this,a,e,n,l,h,u,x,y,w),s&&(s.faceIndex=Math.floor(m/3),t.push(s))}}}};Rr=new st,Pd=new st,Id=new st,k0=new st,kd=new Le,Ka=new L,Bl=new en,Dd=new Le,Hl=new as,os=class extends It{constructor(e,t){super(e,t),this.isSkinnedMesh=!0,this.type="SkinnedMesh",this.bindMode=ql,this.bindMatrix=new Le,this.bindMatrixInverse=new Le,this.boundingBox=null,this.boundingSphere=null}computeBoundingBox(){let e=this.geometry;this.boundingBox===null&&(this.boundingBox=new Tt),this.boundingBox.makeEmpty();let t=e.getAttribute("position");for(let n=0;n<t.count;n++)this.getVertexPosition(n,Ka),this.boundingBox.expandByPoint(Ka)}computeBoundingSphere(){let e=this.geometry;this.boundingSphere===null&&(this.boundingSphere=new en),this.boundingSphere.makeEmpty();let t=e.getAttribute("position");for(let n=0;n<t.count;n++)this.getVertexPosition(n,Ka),this.boundingSphere.expandByPoint(Ka)}copy(e,t){return super.copy(e,t),this.bindMode=e.bindMode,this.bindMatrix.copy(e.bindMatrix),this.bindMatrixInverse.copy(e.bindMatrixInverse),this.skeleton=e.skeleton,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}raycast(e,t){let n=this.material,s=this.matrixWorld;n!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),Bl.copy(this.boundingSphere),Bl.applyMatrix4(s),e.ray.intersectsSphere(Bl)!==!1&&(Dd.copy(s).invert(),Hl.copy(e.ray).applyMatrix4(Dd),!(this.boundingBox!==null&&Hl.intersectsBox(this.boundingBox)===!1)&&this._computeIntersections(e,t,Hl)))}getVertexPosition(e,t){return super.getVertexPosition(e,t),this.applyBoneTransform(e,t),t}bind(e,t){this.skeleton=e,t===void 0&&(this.updateMatrixWorld(!0),this.skeleton.calculateInverses(),t=this.matrixWorld),this.bindMatrix.copy(t),this.bindMatrixInverse.copy(t).invert()}pose(){this.skeleton.pose()}normalizeSkinWeights(){let e=new st,t=this.geometry.attributes.skinWeight;for(let n=0,s=t.count;n<s;n++){e.fromBufferAttribute(t,n);let r=1/e.manhattanLength();r!==1/0?e.multiplyScalar(r):e.set(1,0,0,0),t.setXYZW(n,e.x,e.y,e.z,e.w)}}updateMatrixWorld(e){super.updateMatrixWorld(e),this.bindMode===ql?this.bindMatrixInverse.copy(this.matrixWorld).invert():this.bindMode===vf?this.bindMatrixInverse.copy(this.bindMatrix).invert():ye("SkinnedMesh: Unrecognized bindMode: "+this.bindMode)}applyBoneTransform(e,t){let n=this.skeleton,s=this.geometry;Pd.fromBufferAttribute(s.attributes.skinIndex,e),Id.fromBufferAttribute(s.attributes.skinWeight,e),t.isVector4?(Rr.copy(t),t.set(0,0,0,0)):(Rr.set(...t,1),t.set(0,0,0)),Rr.applyMatrix4(this.bindMatrix);for(let r=0;r<4;r++){let a=Id.getComponent(r);if(a!==0){let o=Pd.getComponent(r);kd.multiplyMatrices(n.bones[o].matrixWorld,n.boneInverses[o]),t.addScaledVector(k0.copy(Rr).applyMatrix4(kd),a)}}return t.isVector4&&(t.w=Rr.w),t.applyMatrix4(this.bindMatrixInverse)}},Zs=class extends rt{constructor(){super(),this.isBone=!0,this.type="Bone"}},Qs=class extends Ot{constructor(e=null,t=1,n=1,s,r,a,o,c,l=yt,h=yt,u,d){super(null,a,o,c,l,h,s,r,u,d),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}},Fd=new Le,D0=new Le,cs=class i{constructor(e=[],t=[]){this.uuid=kn(),this.bones=e.slice(0),this.boneInverses=t,this.boneMatrices=null,this.previousBoneMatrices=null,this.boneTexture=null,this.init()}init(){let e=this.bones,t=this.boneInverses;if(this.boneMatrices=new Float32Array(e.length*16),t.length===0)this.calculateInverses();else if(e.length!==t.length){ye("Skeleton: Number of inverse bone matrices does not match amount of bones."),this.boneInverses=[];for(let n=0,s=this.bones.length;n<s;n++)this.boneInverses.push(new Le)}}calculateInverses(){this.boneInverses.length=0;for(let e=0,t=this.bones.length;e<t;e++){let n=new Le;this.bones[e]&&n.copy(this.bones[e].matrixWorld).invert(),this.boneInverses.push(n)}}pose(){for(let e=0,t=this.bones.length;e<t;e++){let n=this.bones[e];n&&n.matrixWorld.copy(this.boneInverses[e]).invert()}for(let e=0,t=this.bones.length;e<t;e++){let n=this.bones[e];n&&(n.parent&&n.parent.isBone?(n.matrix.copy(n.parent.matrixWorld).invert(),n.matrix.multiply(n.matrixWorld)):n.matrix.copy(n.matrixWorld),n.matrix.decompose(n.position,n.quaternion,n.scale))}}update(){let e=this.bones,t=this.boneInverses,n=this.boneMatrices,s=this.boneTexture;for(let r=0,a=e.length;r<a;r++){let o=e[r]?e[r].matrixWorld:D0;Fd.multiplyMatrices(o,t[r]),Fd.toArray(n,r*16)}s!==null&&(s.needsUpdate=!0)}clone(){return new i(this.bones,this.boneInverses)}computeBoneTexture(){let e=Math.sqrt(this.bones.length*4);e=Math.ceil(e/4)*4,e=Math.max(e,4);let t=new Float32Array(e*e*4);t.set(this.boneMatrices);let n=new Qs(t,e,e,gn,mn);return n.needsUpdate=!0,this.boneMatrices=t,this.boneTexture=n,this}getBoneByName(e){for(let t=0,n=this.bones.length;t<n;t++){let s=this.bones[t];if(s.name===e)return s}}dispose(){this.boneTexture!==null&&(this.boneTexture.dispose(),this.boneTexture=null)}fromJSON(e,t){this.uuid=e.uuid;for(let n=0,s=e.bones.length;n<s;n++){let r=e.bones[n],a=t[r];a===void 0&&(ye("Skeleton: No bone found with UUID:",r),a=new Zs),this.bones.push(a),this.boneInverses.push(new Le().fromArray(e.boneInverses[n]))}return this.init(),this}toJSON(){let e={metadata:{version:4.7,type:"Skeleton",generator:"Skeleton.toJSON"},bones:[],boneInverses:[]};e.uuid=this.uuid;let t=this.bones,n=this.boneInverses;for(let s=0,r=t.length;s<r;s++){let a=t[s];e.bones.push(a.uuid);let o=n[s];e.boneInverses.push(o.toArray())}return e}},ki=class extends Et{constructor(e,t,n,s=1){super(e,t,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=s}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){let e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}},Bs=new Le,Nd=new Le,Ja=[],Ud=new Tt,F0=new Le,Cr=new It,Lr=new en,zr=class extends It{constructor(e,t,n){super(e,t),this.isInstancedMesh=!0,this.instanceMatrix=new ki(new Float32Array(n*16),16),this.previousInstanceMatrix=null,this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let s=0;s<n;s++)this.setMatrixAt(s,F0)}computeBoundingBox(){let e=this.geometry,t=this.count;this.boundingBox===null&&(this.boundingBox=new Tt),e.boundingBox===null&&e.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Bs),Ud.copy(e.boundingBox).applyMatrix4(Bs),this.boundingBox.union(Ud)}computeBoundingSphere(){let e=this.geometry,t=this.count;this.boundingSphere===null&&(this.boundingSphere=new en),e.boundingSphere===null&&e.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Bs),Lr.copy(e.boundingSphere).applyMatrix4(Bs),this.boundingSphere.union(Lr)}copy(e,t){return super.copy(e,t),this.instanceMatrix.copy(e.instanceMatrix),e.previousInstanceMatrix!==null&&(this.previousInstanceMatrix=e.previousInstanceMatrix.clone()),e.morphTexture!==null&&(this.morphTexture=e.morphTexture.clone()),e.instanceColor!==null&&(this.instanceColor=e.instanceColor.clone()),this.count=e.count,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}getColorAt(e,t){return this.instanceColor===null?t.setRGB(1,1,1):t.fromArray(this.instanceColor.array,e*3)}getMatrixAt(e,t){return t.fromArray(this.instanceMatrix.array,e*16)}getMorphAt(e,t){let n=t.morphTargetInfluences,s=this.morphTexture.source.data.data,r=n.length+1,a=e*r+1;for(let o=0;o<n.length;o++)n[o]=s[a+o]}raycast(e,t){let n=this.matrixWorld,s=this.count;if(Cr.geometry=this.geometry,Cr.material=this.material,Cr.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),Lr.copy(this.boundingSphere),Lr.applyMatrix4(n),e.ray.intersectsSphere(Lr)!==!1))for(let r=0;r<s;r++){this.getMatrixAt(r,Bs),Nd.multiplyMatrices(n,Bs),Cr.matrixWorld=Nd,Cr.raycast(e,Ja);for(let a=0,o=Ja.length;a<o;a++){let c=Ja[a];c.instanceId=r,c.object=this,t.push(c)}Ja.length=0}}setColorAt(e,t){return this.instanceColor===null&&(this.instanceColor=new ki(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),t.toArray(this.instanceColor.array,e*3),this}setMatrixAt(e,t){return t.toArray(this.instanceMatrix.array,e*16),this}setMorphAt(e,t){let n=t.morphTargetInfluences,s=n.length+1;this.morphTexture===null&&(this.morphTexture=new Qs(new Float32Array(s*this.count),s,this.count,Go,mn));let r=this.morphTexture.source.data.data,a=0;for(let l=0;l<n.length;l++)a+=n[l];let o=this.geometry.morphTargetsRelative?1:1-a,c=s*e;return r[c]=o,r.set(n,c+1),this}updateMorphTargets(){}dispose(){this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}},zl=new L,N0=new L,U0=new ke,qn=class{constructor(e=new L(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,s){return this.normal.set(e,t,n),this.constant=s,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let s=zl.subVectors(n,t).cross(N0.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(s,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t,n=!0){let s=e.delta(zl),r=this.normal.dot(s);if(r===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let a=-(e.start.dot(this.normal)+this.constant)/r;return n===!0&&(a<0||a>1)?null:t.copy(e.start).addScaledVector(s,a)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||U0.getNormalMatrix(e),s=this.coplanarPoint(zl).applyMatrix4(e),r=this.normal.applyMatrix3(n).normalize();return this.constant=-s.dot(r),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},Ji=new en,O0=new Ie(.5,.5),$a=new L,er=class{constructor(e=new qn,t=new qn,n=new qn,s=new qn,r=new qn,a=new qn){this.planes=[e,t,n,s,r,a]}set(e,t,n,s,r,a){let o=this.planes;return o[0].copy(e),o[1].copy(t),o[2].copy(n),o[3].copy(s),o[4].copy(r),o[5].copy(a),this}copy(e){let t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=In,n=!1){let s=this.planes,r=e.elements,a=r[0],o=r[1],c=r[2],l=r[3],h=r[4],u=r[5],d=r[6],f=r[7],g=r[8],_=r[9],m=r[10],p=r[11],x=r[12],y=r[13],w=r[14],A=r[15];if(s[0].setComponents(l-a,f-h,p-g,A-x).normalize(),s[1].setComponents(l+a,f+h,p+g,A+x).normalize(),s[2].setComponents(l+o,f+u,p+_,A+y).normalize(),s[3].setComponents(l-o,f-u,p-_,A-y).normalize(),n)s[4].setComponents(c,d,m,w).normalize(),s[5].setComponents(l-c,f-d,p-m,A-w).normalize();else if(s[4].setComponents(l-c,f-d,p-m,A-w).normalize(),t===In)s[5].setComponents(l+c,f+d,p+m,A+w).normalize();else if(t===qs)s[5].setComponents(c,d,m,w).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),Ji.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),Ji.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(Ji)}intersectsSprite(e){Ji.center.set(0,0,0);let t=O0.distanceTo(e.center);return Ji.radius=.7071067811865476+t,Ji.applyMatrix4(e.matrixWorld),this.intersectsSphere(Ji)}intersectsSphere(e){let t=this.planes,n=e.center,s=-e.radius;for(let r=0;r<6;r++)if(t[r].distanceToPoint(n)<s)return!1;return!0}intersectsBox(e){let t=this.planes;for(let n=0;n<6;n++){let s=t[n];if($a.x=s.normal.x>0?e.max.x:e.min.x,$a.y=s.normal.y>0?e.max.y:e.min.y,$a.z=s.normal.z>0?e.max.z:e.min.z,s.distanceToPoint($a)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}},tr=class extends tn{constructor(e){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new Ee(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}},vo=new L,yo=new L,Od=new Le,Pr=new as,Za=new en,Vl=new L,Bd=new L,ls=class extends rt{constructor(e=new Xt,t=new tr){super(),this.isLine=!0,this.type="Line",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[0];for(let s=1,r=t.count;s<r;s++)vo.fromBufferAttribute(t,s-1),yo.fromBufferAttribute(t,s),n[s]=n[s-1],n[s]+=vo.distanceTo(yo);e.setAttribute("lineDistance",new Ut(n,1))}else ye("Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(e,t){let n=this.geometry,s=this.matrixWorld,r=e.params.Line.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Za.copy(n.boundingSphere),Za.applyMatrix4(s),Za.radius+=r,e.ray.intersectsSphere(Za)===!1)return;Od.copy(s).invert(),Pr.copy(e.ray).applyMatrix4(Od);let o=r/((this.scale.x+this.scale.y+this.scale.z)/3),c=o*o,l=this.isLineSegments?2:1,h=n.index,d=n.attributes.position;if(h!==null){let f=Math.max(0,a.start),g=Math.min(h.count,a.start+a.count);for(let _=f,m=g-1;_<m;_+=l){let p=h.getX(_),x=h.getX(_+1),y=Qa(this,e,Pr,c,p,x,_);y&&t.push(y)}if(this.isLineLoop){let _=h.getX(g-1),m=h.getX(f),p=Qa(this,e,Pr,c,_,m,g-1);p&&t.push(p)}}else{let f=Math.max(0,a.start),g=Math.min(d.count,a.start+a.count);for(let _=f,m=g-1;_<m;_+=l){let p=Qa(this,e,Pr,c,_,_+1,_);p&&t.push(p)}if(this.isLineLoop){let _=Qa(this,e,Pr,c,g-1,f,g-1);_&&t.push(_)}}}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=s.length;r<a;r++){let o=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}};Hd=new L,zd=new L,Vr=class extends ls{constructor(e,t){super(e,t),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[];for(let s=0,r=t.count;s<r;s+=2)Hd.fromBufferAttribute(t,s),zd.fromBufferAttribute(t,s+1),n[s]=s===0?0:n[s-1],n[s+1]=n[s]+Hd.distanceTo(zd);e.setAttribute("lineDistance",new Ut(n,1))}else ye("LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}},Gr=class extends ls{constructor(e,t){super(e,t),this.isLineLoop=!0,this.type="LineLoop"}},nr=class extends tn{constructor(e){super(),this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new Ee(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.size=e.size,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}},Vd=new Le,Yl=new as,eo=new en,to=new L,Wr=class extends rt{constructor(e=new Xt,t=new nr){super(),this.isPoints=!0,this.type="Points",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}raycast(e,t){let n=this.geometry,s=this.matrixWorld,r=e.params.Points.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),eo.copy(n.boundingSphere),eo.applyMatrix4(s),eo.radius+=r,e.ray.intersectsSphere(eo)===!1)return;Vd.copy(s).invert(),Yl.copy(e.ray).applyMatrix4(Vd);let o=r/((this.scale.x+this.scale.y+this.scale.z)/3),c=o*o,l=n.index,u=n.attributes.position;if(l!==null){let d=Math.max(0,a.start),f=Math.min(l.count,a.start+a.count);for(let g=d,_=f;g<_;g++){let m=l.getX(g);to.fromBufferAttribute(u,m),Gd(to,m,c,s,e,t,this)}}else{let d=Math.max(0,a.start),f=Math.min(u.count,a.start+a.count);for(let g=d,_=f;g<_;g++)to.fromBufferAttribute(u,g),Gd(to,g,c,s,e,t,this)}}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=s.length;r<a;r++){let o=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}};qr=class extends Ot{constructor(e=[],t=Oi,n,s,r,a,o,c,l,h){super(e,t,n,s,r,a,o,c,l,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},fi=class extends Ot{constructor(e,t,n=Bn,s,r,a,o=yt,c=yt,l,h=jn,u=1){if(h!==jn&&h!==Bi)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let d={width:e,height:t,depth:u};super(d,s,r,a,o,c,h,n,l),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new Ys(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}},wo=class extends fi{constructor(e,t=Bn,n=Oi,s,r,a=yt,o=yt,c,l=jn){let h={width:e,height:e,depth:1},u=[h,h,h,h,h,h];super(e,e,t,n,s,r,a,o,c,l),this.image=u,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(e){this.image=e}},Xr=class extends Ot{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},ir=class i extends Xt{constructor(e=1,t=1,n=1,s=1,r=1,a=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:s,heightSegments:r,depthSegments:a};let o=this;s=Math.floor(s),r=Math.floor(r),a=Math.floor(a);let c=[],l=[],h=[],u=[],d=0,f=0;g("z","y","x",-1,-1,n,t,e,a,r,0),g("z","y","x",1,-1,n,t,-e,a,r,1),g("x","z","y",1,1,e,n,t,s,a,2),g("x","z","y",1,-1,e,n,-t,s,a,3),g("x","y","z",1,-1,e,t,n,s,r,4),g("x","y","z",-1,-1,e,t,-n,s,r,5),this.setIndex(c),this.setAttribute("position",new Ut(l,3)),this.setAttribute("normal",new Ut(h,3)),this.setAttribute("uv",new Ut(u,2));function g(_,m,p,x,y,w,A,S,R,b,T){let P=w/R,C=A/b,N=w/2,G=A/2,q=S/2,F=R+1,H=b+1,V=0,Z=0,Q=new L;for(let le=0;le<H;le++){let xe=le*C-G;for(let Se=0;Se<F;Se++){let Ye=Se*P-N;Q[_]=Ye*x,Q[m]=xe*y,Q[p]=q,l.push(Q.x,Q.y,Q.z),Q[_]=0,Q[m]=0,Q[p]=S>0?1:-1,h.push(Q.x,Q.y,Q.z),u.push(Se/R),u.push(1-le/b),V+=1}}for(let le=0;le<b;le++)for(let xe=0;xe<R;xe++){let Se=d+xe+F*le,Ye=d+xe+F*(le+1),Qe=d+(xe+1)+F*(le+1),Ue=d+(xe+1)+F*le;c.push(Se,Ye,Ue),c.push(Ye,Qe,Ue),Z+=6}o.addGroup(f,Z,T),f+=Z,d+=V}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}},jr=class i extends Xt{constructor(e=1,t=32,n=0,s=Math.PI*2){super(),this.type="CircleGeometry",this.parameters={radius:e,segments:t,thetaStart:n,thetaLength:s},t=Math.max(3,t);let r=[],a=[],o=[],c=[],l=new L,h=new Ie;a.push(0,0,0),o.push(0,0,1),c.push(.5,.5);for(let u=0,d=3;u<=t;u++,d+=3){let f=n+u/t*s;l.x=e*Math.cos(f),l.y=e*Math.sin(f),a.push(l.x,l.y,l.z),o.push(0,0,1),h.x=(a[d]/e+1)/2,h.y=(a[d+1]/e+1)/2,c.push(h.x,h.y)}for(let u=1;u<=t;u++)r.push(u,u+1,0);this.setIndex(r),this.setAttribute("position",new Ut(a,3)),this.setAttribute("normal",new Ut(o,3)),this.setAttribute("uv",new Ut(c,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.segments,e.thetaStart,e.thetaLength)}},Yr=class i extends Xt{constructor(e=1,t=1,n=1,s=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:s};let r=e/2,a=t/2,o=Math.floor(n),c=Math.floor(s),l=o+1,h=c+1,u=e/o,d=t/c,f=[],g=[],_=[],m=[];for(let p=0;p<h;p++){let x=p*d-a;for(let y=0;y<l;y++){let w=y*u-r;g.push(w,-x,0),_.push(0,0,1),m.push(y/o),m.push(1-p/c)}}for(let p=0;p<c;p++)for(let x=0;x<o;x++){let y=x+l*p,w=x+l*(p+1),A=x+1+l*(p+1),S=x+1+l*p;f.push(y,w,S),f.push(w,A,S)}this.setIndex(f),this.setAttribute("position",new Ut(g,3)),this.setAttribute("normal",new Ut(_,3)),this.setAttribute("uv",new Ut(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.widthSegments,e.heightSegments)}};Nf={clone:ms,merge:jt},H0=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,z0=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,pn=class extends tn{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=H0,this.fragmentShader=z0,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=ms(e.uniforms),this.uniformsGroups=B0(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this.defaultAttributeValues=Object.assign({},e.defaultAttributeValues),this.index0AttributeName=e.index0AttributeName,this.uniformsNeedUpdate=e.uniformsNeedUpdate,this}toJSON(e){let t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(let s in this.uniforms){let a=this.uniforms[s].value;a&&a.isTexture?t.uniforms[s]={type:"t",value:a.toJSON(e).uuid}:a&&a.isColor?t.uniforms[s]={type:"c",value:a.getHex()}:a&&a.isVector2?t.uniforms[s]={type:"v2",value:a.toArray()}:a&&a.isVector3?t.uniforms[s]={type:"v3",value:a.toArray()}:a&&a.isVector4?t.uniforms[s]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?t.uniforms[s]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?t.uniforms[s]={type:"m4",value:a.toArray()}:t.uniforms[s]={value:a}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;let n={};for(let s in this.extensions)this.extensions[s]===!0&&(n[s]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}},Mo=class extends pn{constructor(e){super(e),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}},hs=class extends tn{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new Ee(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Ee(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Sc,this.normalScale=new Ie(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Bt,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},nn=class extends hs{constructor(e){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:"",PHYSICAL:""},this.type="MeshPhysicalMaterial",this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new Ie(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return We(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(t){this.ior=(1+.4*t)/(1-.4*t)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new Ee(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new Ee(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new Ee(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._dispersion=0,this._iridescence=0,this._sheen=0,this._transmission=0,this.setValues(e)}get anisotropy(){return this._anisotropy}set anisotropy(e){this._anisotropy>0!=e>0&&this.version++,this._anisotropy=e}get clearcoat(){return this._clearcoat}set clearcoat(e){this._clearcoat>0!=e>0&&this.version++,this._clearcoat=e}get iridescence(){return this._iridescence}set iridescence(e){this._iridescence>0!=e>0&&this.version++,this._iridescence=e}get dispersion(){return this._dispersion}set dispersion(e){this._dispersion>0!=e>0&&this.version++,this._dispersion=e}get sheen(){return this._sheen}set sheen(e){this._sheen>0!=e>0&&this.version++,this._sheen=e}get transmission(){return this._transmission}set transmission(e){this._transmission>0!=e>0&&this.version++,this._transmission=e}copy(e){return super.copy(e),this.defines={STANDARD:"",PHYSICAL:""},this.anisotropy=e.anisotropy,this.anisotropyRotation=e.anisotropyRotation,this.anisotropyMap=e.anisotropyMap,this.clearcoat=e.clearcoat,this.clearcoatMap=e.clearcoatMap,this.clearcoatRoughness=e.clearcoatRoughness,this.clearcoatRoughnessMap=e.clearcoatRoughnessMap,this.clearcoatNormalMap=e.clearcoatNormalMap,this.clearcoatNormalScale.copy(e.clearcoatNormalScale),this.dispersion=e.dispersion,this.ior=e.ior,this.iridescence=e.iridescence,this.iridescenceMap=e.iridescenceMap,this.iridescenceIOR=e.iridescenceIOR,this.iridescenceThicknessRange=[...e.iridescenceThicknessRange],this.iridescenceThicknessMap=e.iridescenceThicknessMap,this.sheen=e.sheen,this.sheenColor.copy(e.sheenColor),this.sheenColorMap=e.sheenColorMap,this.sheenRoughness=e.sheenRoughness,this.sheenRoughnessMap=e.sheenRoughnessMap,this.transmission=e.transmission,this.transmissionMap=e.transmissionMap,this.thickness=e.thickness,this.thicknessMap=e.thicknessMap,this.attenuationDistance=e.attenuationDistance,this.attenuationColor.copy(e.attenuationColor),this.specularIntensity=e.specularIntensity,this.specularIntensityMap=e.specularIntensityMap,this.specularColor.copy(e.specularColor),this.specularColorMap=e.specularColorMap,this}},So=class extends tn{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=wf,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},Ao=class extends tn{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};Kr=class{static convertArray(e,t){return es(e,t)}static isTypedArray(e){return Lf(e)}static getKeyframeOrder(e){return Uf(e)}static sortedArray(e,t,n){return Kl(e,t,n)}static flattenJSON(e,t,n,s){Ah(e,t,n,s)}static subclip(e,t,n,s,r=30){return V0(e,t,n,s,r)}static makeClipAdditive(e,t=0,n=e,s=30){return G0(e,t,n,s)}},Yn=class{constructor(e,t,n,s){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=s!==void 0?s:new t.constructor(n),this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,n=this._cachedIndex,s=t[n],r=t[n-1];e:{t:{let a;n:{i:if(!(e<s)){for(let o=n+2;;){if(s===void 0){if(e<r)break i;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===o)break;if(r=s,s=t[++n],e<s)break t}a=t.length;break n}if(!(e>=r)){let o=t[1];e<o&&(n=2,r=o);for(let c=n-2;;){if(r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===c)break;if(s=r,r=t[--n-1],e>=r)break t}a=n,n=0;break n}break e}for(;n<a;){let o=n+a>>>1;e<t[o]?a=o:n=o+1}if(s=t[n],r=t[n-1],r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(s===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,r,s)}return this.interpolate_(n,r,e,s)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,s=this.valueSize,r=e*s;for(let a=0;a!==s;++a)t[a]=n[r+a];return t}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},Eo=class extends Yn{constructor(e,t,n,s){super(e,t,n,s),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:Zi,endingEnd:Zi}}intervalChanged_(e,t,n){let s=this.parameterPositions,r=e-2,a=e+1,o=s[r],c=s[a];if(o===void 0)switch(this.getSettings_().endingStart){case Qi:r=e,o=2*t-n;break;case Dr:r=s.length-2,o=t+s[r]-s[r+1];break;default:r=e,o=n}if(c===void 0)switch(this.getSettings_().endingEnd){case Qi:a=e,c=2*n-t;break;case Dr:a=1,c=n+s[1]-s[0];break;default:a=e-1,c=t}let l=(n-t)*.5,h=this.valueSize;this._weightPrev=l/(t-o),this._weightNext=l/(c-n),this._offsetPrev=r*h,this._offsetNext=a*h}interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,c=e*o,l=c-o,h=this._offsetPrev,u=this._offsetNext,d=this._weightPrev,f=this._weightNext,g=(n-t)/(s-t),_=g*g,m=_*g,p=-d*m+2*d*_-d*g,x=(1+d)*m+(-1.5-2*d)*_+(-.5+d)*g+1,y=(-1-f)*m+(1.5+f)*_+.5*g,w=f*m-f*_;for(let A=0;A!==o;++A)r[A]=p*a[h+A]+x*a[l+A]+y*a[c+A]+w*a[u+A];return r}},Jr=class extends Yn{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,c=e*o,l=c-o,h=(n-t)/(s-t),u=1-h;for(let d=0;d!==o;++d)r[d]=a[l+d]*u+a[c+d]*h;return r}},To=class extends Yn{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e){return this.copySampleValue_(e-1)}},Ro=class extends Yn{interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,c=e*o,l=c-o,h=this.settings||this.DefaultSettings_,u=h.inTangents,d=h.outTangents;if(!u||!d){let _=(n-t)/(s-t),m=1-_;for(let p=0;p!==o;++p)r[p]=a[l+p]*m+a[c+p]*_;return r}let f=o*2,g=e-1;for(let _=0;_!==o;++_){let m=a[l+_],p=a[c+_],x=g*f+_*2,y=d[x],w=d[x+1],A=e*f+_*2,S=u[A],R=u[A+1],b=(n-t)/(s-t),T,P,C,N,G;for(let q=0;q<8;q++){T=b*b,P=T*b,C=1-b,N=C*C,G=N*C;let H=G*t+3*N*b*y+3*C*T*S+P*s-n;if(Math.abs(H)<1e-10)break;let V=3*N*(y-t)+6*C*b*(S-y)+3*T*(s-S);if(Math.abs(V)<1e-10)break;b=b-H/V,b=Math.max(0,Math.min(1,b))}r[_]=G*m+3*N*b*w+3*C*T*R+P*p}return r}},sn=class{constructor(e,t,n,s){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=es(t,this.TimeBufferType),this.values=es(n,this.ValueBufferType),this.setInterpolation(s||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:es(e.times,Array),values:es(e.values,Array)};let s=e.getInterpolation();s!==e.DefaultInterpolation&&(n.interpolation=s)}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new To(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new Jr(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new Eo(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let t=new Ro(this.times,this.values,this.getValueSize(),e);return this.settings&&(t.settings=this.settings),t}setInterpolation(e){let t;switch(e){case is:t=this.InterpolantFactoryMethodDiscrete;break;case ss:t=this.InterpolantFactoryMethodLinear;break;case so:t=this.InterpolantFactoryMethodSmooth;break;case Xl:t=this.InterpolantFactoryMethodBezier;break}if(t===void 0){let n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return ye("KeyframeTrack:",n),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return is;case this.InterpolantFactoryMethodLinear:return ss;case this.InterpolantFactoryMethodSmooth:return so;case this.InterpolantFactoryMethodBezier:return Xl}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let n=0,s=t.length;n!==s;++n)t[n]+=e}return this}scale(e){if(e!==1){let t=this.times;for(let n=0,s=t.length;n!==s;++n)t[n]*=e}return this}trim(e,t){let n=this.times,s=n.length,r=0,a=s-1;for(;r!==s&&n[r]<e;)++r;for(;a!==-1&&n[a]>t;)--a;if(++a,r!==0||a!==s){r>=a&&(a=Math.max(a,1),r=a-1);let o=this.getValueSize();this.times=n.slice(r,a),this.values=this.values.slice(r*o,a*o)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(Te("KeyframeTrack: Invalid value size in track.",this),e=!1);let n=this.times,s=this.values,r=n.length;r===0&&(Te("KeyframeTrack: Track is empty.",this),e=!1);let a=null;for(let o=0;o!==r;o++){let c=n[o];if(typeof c=="number"&&isNaN(c)){Te("KeyframeTrack: Time is not a valid number.",this,o,c),e=!1;break}if(a!==null&&a>c){Te("KeyframeTrack: Out of order keys.",this,o,c,a),e=!1;break}a=c}if(s!==void 0&&Lf(s))for(let o=0,c=s.length;o!==c;++o){let l=s[o];if(isNaN(l)){Te("KeyframeTrack: Value is not a valid number.",this,o,l),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),s=this.getInterpolation()===so,r=e.length-1,a=1;for(let o=1;o<r;++o){let c=!1,l=e[o],h=e[o+1];if(l!==h&&(o!==1||l!==e[0]))if(s)c=!0;else{let u=o*n,d=u-n,f=u+n;for(let g=0;g!==n;++g){let _=t[u+g];if(_!==t[d+g]||_!==t[f+g]){c=!0;break}}}if(c){if(o!==a){e[a]=e[o];let u=o*n,d=a*n;for(let f=0;f!==n;++f)t[d+f]=t[u+f]}++a}}if(r>0){e[a]=e[r];for(let o=r*n,c=a*n,l=0;l!==n;++l)t[c+l]=t[o+l];++a}return a!==e.length?(this.times=e.slice(0,a),this.values=t.slice(0,a*n)):(this.times=e,this.values=t),this}clone(){let e=this.times.slice(),t=this.values.slice(),n=this.constructor,s=new n(this.name,e,t);return s.createInterpolant=this.createInterpolant,s}};sn.prototype.ValueTypeName="";sn.prototype.TimeBufferType=Float32Array;sn.prototype.ValueBufferType=Float32Array;sn.prototype.DefaultInterpolation=ss;pi=class extends sn{constructor(e,t,n){super(e,t,n)}};pi.prototype.ValueTypeName="bool";pi.prototype.ValueBufferType=Array;pi.prototype.DefaultInterpolation=is;pi.prototype.InterpolantFactoryMethodLinear=void 0;pi.prototype.InterpolantFactoryMethodSmooth=void 0;$r=class extends sn{constructor(e,t,n,s){super(e,t,n,s)}};$r.prototype.ValueTypeName="color";Mn=class extends sn{constructor(e,t,n,s){super(e,t,n,s)}};Mn.prototype.ValueTypeName="number";Co=class extends Yn{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,c=(n-t)/(s-t),l=e*o;for(let h=l+o;l!==h;l+=4)ge.slerpFlat(r,0,a,l-o,a,l,c);return r}},Sn=class extends sn{constructor(e,t,n,s){super(e,t,n,s)}InterpolantFactoryMethodLinear(e){return new Co(this.times,this.values,this.getValueSize(),e)}};Sn.prototype.ValueTypeName="quaternion";Sn.prototype.InterpolantFactoryMethodSmooth=void 0;mi=class extends sn{constructor(e,t,n){super(e,t,n)}};mi.prototype.ValueTypeName="string";mi.prototype.ValueBufferType=Array;mi.prototype.DefaultInterpolation=is;mi.prototype.InterpolantFactoryMethodLinear=void 0;mi.prototype.InterpolantFactoryMethodSmooth=void 0;Kn=class extends sn{constructor(e,t,n,s){super(e,t,n,s)}};Kn.prototype.ValueTypeName="vector";$t=class{constructor(e="",t=-1,n=[],s=Mc){this.name=e,this.tracks=n,this.duration=t,this.blendMode=s,this.uuid=kn(),this.userData={},this.duration<0&&this.resetDuration()}static parse(e){let t=[],n=e.tracks,s=1/(e.fps||1);for(let a=0,o=n.length;a!==o;++a)t.push(q0(n[a]).scale(s));let r=new this(e.name,e.duration,t,e.blendMode);return r.uuid=e.uuid,r.userData=JSON.parse(e.userData||"{}"),r}static toJSON(e){let t=[],n=e.tracks,s={name:e.name,duration:e.duration,tracks:t,uuid:e.uuid,blendMode:e.blendMode,userData:JSON.stringify(e.userData)};for(let r=0,a=n.length;r!==a;++r)t.push(sn.toJSON(n[r]));return s}static CreateFromMorphTargetSequence(e,t,n,s){let r=t.length,a=[];for(let o=0;o<r;o++){let c=[],l=[];c.push((o+r-1)%r,o,(o+1)%r),l.push(0,1,0);let h=Uf(c);c=Kl(c,1,h),l=Kl(l,1,h),!s&&c[0]===0&&(c.push(r),l.push(l[0])),a.push(new Mn(".morphTargetInfluences["+t[o].name+"]",c,l).scale(1/n))}return new this(e,-1,a)}static findByName(e,t){let n=e;if(!Array.isArray(e)){let s=e;n=s.geometry&&s.geometry.animations||s.animations}for(let s=0;s<n.length;s++)if(n[s].name===t)return n[s];return null}static CreateClipsFromMorphTargetSequences(e,t,n){let s={},r=/^([\w-]*?)([\d]+)$/;for(let o=0,c=e.length;o<c;o++){let l=e[o],h=l.name.match(r);if(h&&h.length>1){let u=h[1],d=s[u];d||(s[u]=d=[]),d.push(l)}}let a=[];for(let o in s)a.push(this.CreateFromMorphTargetSequence(o,s[o],t,n));return a}static parseAnimation(e,t){if(ye("AnimationClip: parseAnimation() is deprecated and will be removed with r185"),!e)return Te("AnimationClip: No animation in JSONLoader data."),null;let n=function(u,d,f,g,_){if(f.length!==0){let m=[],p=[];Ah(f,m,p,g),m.length!==0&&_.push(new u(d,m,p))}},s=[],r=e.name||"default",a=e.fps||30,o=e.blendMode,c=e.length||-1,l=e.hierarchy||[];for(let u=0;u<l.length;u++){let d=l[u].keys;if(!(!d||d.length===0))if(d[0].morphTargets){let f={},g;for(g=0;g<d.length;g++)if(d[g].morphTargets)for(let _=0;_<d[g].morphTargets.length;_++)f[d[g].morphTargets[_]]=-1;for(let _ in f){let m=[],p=[];for(let x=0;x!==d[g].morphTargets.length;++x){let y=d[g];m.push(y.time),p.push(y.morphTarget===_?1:0)}s.push(new Mn(".morphTargetInfluence["+_+"]",m,p))}c=f.length*a}else{let f=".bones["+t[u].name+"]";n(Kn,f+".position",d,"pos",s),n(Sn,f+".quaternion",d,"rot",s),n(Kn,f+".scale",d,"scl",s)}}return s.length===0?null:new this(r,c,s,o)}resetDuration(){let e=this.tracks,t=0;for(let n=0,s=e.length;n!==s;++n){let r=this.tracks[n];t=Math.max(t,r.times[r.times.length-1])}return this.duration=t,this}trim(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].trim(0,this.duration);return this}validate(){let e=!0;for(let t=0;t<this.tracks.length;t++)e=e&&this.tracks[t].validate();return e}optimize(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].optimize();return this}clone(){let e=[];for(let n=0;n<this.tracks.length;n++)e.push(this.tracks[n].clone());let t=new this.constructor(this.name,this.duration,e,this.blendMode);return t.userData=JSON.parse(JSON.stringify(this.userData)),t}toJSON(){return this.constructor.toJSON(this)}};Xn={enabled:!1,files:{},add:function(i,e){this.enabled!==!1&&(qd(i)||(this.files[i]=e))},get:function(i){if(this.enabled!==!1&&!qd(i))return this.files[i]},remove:function(i){delete this.files[i]},clear:function(){this.files={}}};Lo=class{constructor(e,t,n){let s=this,r=!1,a=0,o=0,c,l=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this._abortController=null,this.itemStart=function(h){o++,r===!1&&s.onStart!==void 0&&s.onStart(h,a,o),r=!0},this.itemEnd=function(h){a++,s.onProgress!==void 0&&s.onProgress(h,a,o),a===o&&(r=!1,s.onLoad!==void 0&&s.onLoad())},this.itemError=function(h){s.onError!==void 0&&s.onError(h)},this.resolveURL=function(h){return c?c(h):h},this.setURLModifier=function(h){return c=h,this},this.addHandler=function(h,u){return l.push(h,u),this},this.removeHandler=function(h){let u=l.indexOf(h);return u!==-1&&l.splice(u,2),this},this.getHandler=function(h){for(let u=0,d=l.length;u<d;u+=2){let f=l[u],g=l[u+1];if(f.global&&(f.lastIndex=0),f.test(h))return g}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},Of=new Lo,Jn=class{constructor(e){this.manager=e!==void 0?e:Of,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(e,t){let n=this;return new Promise(function(s,r){n.load(e,s,t,r)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};Jn.DEFAULT_MATERIAL_NAME="__DEFAULT";ui={},Jl=class extends Error{constructor(e,t){super(e),this.response=t}},sr=class extends Jn{constructor(e){super(e),this.mimeType="",this.responseType="",this._abortController=new AbortController}load(e,t,n,s){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let r=Xn.get(`file:${e}`);if(r!==void 0){this.manager.itemStart(e),setTimeout(()=>{t&&t(r),this.manager.itemEnd(e)},0);return}if(ui[e]!==void 0){ui[e].push({onLoad:t,onProgress:n,onError:s});return}ui[e]=[],ui[e].push({onLoad:t,onProgress:n,onError:s});let a=new Request(e,{headers:new Headers(this.requestHeader),credentials:this.withCredentials?"include":"same-origin",signal:typeof AbortSignal.any=="function"?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal}),o=this.mimeType,c=this.responseType;fetch(a).then(l=>{if(l.status===200||l.status===0){if(l.status===0&&ye("FileLoader: HTTP Status 0 received."),typeof ReadableStream>"u"||l.body===void 0||l.body.getReader===void 0)return l;let h=ui[e],u=l.body.getReader(),d=l.headers.get("X-File-Size")||l.headers.get("Content-Length"),f=d?parseInt(d):0,g=f!==0,_=0,m=new ReadableStream({start(p){x();function x(){u.read().then(({done:y,value:w})=>{if(y)p.close();else{_+=w.byteLength;let A=new ProgressEvent("progress",{lengthComputable:g,loaded:_,total:f});for(let S=0,R=h.length;S<R;S++){let b=h[S];b.onProgress&&b.onProgress(A)}p.enqueue(w),x()}},y=>{p.error(y)})}}});return new Response(m)}else throw new Jl(`fetch for "${l.url}" responded with ${l.status}: ${l.statusText}`,l)}).then(l=>{switch(c){case"arraybuffer":return l.arrayBuffer();case"blob":return l.blob();case"document":return l.text().then(h=>new DOMParser().parseFromString(h,o));case"json":return l.json();default:if(o==="")return l.text();{let u=/charset="?([^;"\s]*)"?/i.exec(o),d=u&&u[1]?u[1].toLowerCase():void 0,f=new TextDecoder(d);return l.arrayBuffer().then(g=>f.decode(g))}}}).then(l=>{Xn.add(`file:${e}`,l);let h=ui[e];delete ui[e];for(let u=0,d=h.length;u<d;u++){let f=h[u];f.onLoad&&f.onLoad(l)}}).catch(l=>{let h=ui[e];if(h===void 0)throw this.manager.itemError(e),l;delete ui[e];for(let u=0,d=h.length;u<d;u++){let f=h[u];f.onError&&f.onError(l)}this.manager.itemError(e)}).finally(()=>{this.manager.itemEnd(e)}),this.manager.itemStart(e)}setResponseType(e){return this.responseType=e,this}setMimeType(e){return this.mimeType=e,this}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}},Hs=new WeakMap,Po=class extends Jn{constructor(e){super(e)}load(e,t,n,s){this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let r=this,a=Xn.get(`image:${e}`);if(a!==void 0){if(a.complete===!0)r.manager.itemStart(e),setTimeout(function(){t&&t(a),r.manager.itemEnd(e)},0);else{let u=Hs.get(a);u===void 0&&(u=[],Hs.set(a,u)),u.push({onLoad:t,onError:s})}return a}let o=Xs("img");function c(){h(),t&&t(this);let u=Hs.get(this)||[];for(let d=0;d<u.length;d++){let f=u[d];f.onLoad&&f.onLoad(this)}Hs.delete(this),r.manager.itemEnd(e)}function l(u){h(),s&&s(u),Xn.remove(`image:${e}`);let d=Hs.get(this)||[];for(let f=0;f<d.length;f++){let g=d[f];g.onError&&g.onError(u)}Hs.delete(this),r.manager.itemError(e),r.manager.itemEnd(e)}function h(){o.removeEventListener("load",c,!1),o.removeEventListener("error",l,!1)}return o.addEventListener("load",c,!1),o.addEventListener("error",l,!1),e.slice(0,5)!=="data:"&&this.crossOrigin!==void 0&&(o.crossOrigin=this.crossOrigin),Xn.add(`image:${e}`,o),r.manager.itemStart(e),o.src=e,o}},Zr=class extends Jn{constructor(e){super(e)}load(e,t,n,s){let r=new Ot,a=new Po(this.manager);return a.setCrossOrigin(this.crossOrigin),a.setPath(this.path),a.load(e,function(o){r.image=o,r.needsUpdate=!0,t!==void 0&&t(r)},n,s),r}},Di=class extends rt{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new Ee(e),this.intensity=t}dispose(){this.dispatchEvent({type:"dispose"})}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,t}},Fi=class extends Di{constructor(e,t,n){super(e,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(rt.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Ee(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}toJSON(e){let t=super.toJSON(e);return t.object.groundColor=this.groundColor.getHex(),t}},Gl=new Le,Xd=new L,jd=new L,Qr=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Ie(512,512),this.mapType=an,this.map=null,this.mapPass=null,this.matrix=new Le,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new er,this._frameExtents=new Ie(1,1),this._viewportCount=1,this._viewports=[new st(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let t=this.camera,n=this.matrix;Xd.setFromMatrixPosition(e.matrixWorld),t.position.copy(Xd),jd.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(jd),t.updateMatrixWorld(),Gl.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Gl,t.coordinateSystem,t.reversedDepth),t.coordinateSystem===qs||t.reversedDepth?n.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(Gl)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},no=new L,io=new ge,Wn=new L,ea=class extends rt{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Le,this.projectionMatrix=new Le,this.projectionMatrixInverse=new Le,this.coordinateSystem=In,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(no,io,Wn),Wn.x===1&&Wn.y===1&&Wn.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(no,io,Wn.set(1,1,1)).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorld.decompose(no,io,Wn),Wn.x===1&&Wn.y===1&&Wn.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(no,io,Wn.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},Ri=new L,Yd=new Ie,Kd=new Ie,At=class extends ea{constructor(e=50,t=1,n=.1,s=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=s,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=rs*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(Ir*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return rs*2*Math.atan(Math.tan(Ir*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){Ri.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(Ri.x,Ri.y).multiplyScalar(-e/Ri.z),Ri.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Ri.x,Ri.y).multiplyScalar(-e/Ri.z)}getViewSize(e,t){return this.getViewBounds(e,Yd,Kd),t.subVectors(Kd,Yd)}setViewOffset(e,t,n,s,r,a){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(Ir*.5*this.fov)/this.zoom,n=2*t,s=this.aspect*n,r=-.5*s,a=this.view;if(this.view!==null&&this.view.enabled){let c=a.fullWidth,l=a.fullHeight;r+=a.offsetX*s/c,t-=a.offsetY*n/l,s*=a.width/c,n*=a.height/l}let o=this.filmOffset;o!==0&&(r+=e*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+s,t,t-n,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}},$l=class extends Qr{constructor(){super(new At(50,1,.5,500)),this.isSpotLightShadow=!0,this.focus=1,this.aspect=1}updateMatrices(e){let t=this.camera,n=rs*2*e.angle*this.focus,s=this.mapSize.width/this.mapSize.height*this.aspect,r=e.distance||t.far;(n!==t.fov||s!==t.aspect||r!==t.far)&&(t.fov=n,t.aspect=s,t.far=r,t.updateProjectionMatrix()),super.updateMatrices(e)}copy(e){return super.copy(e),this.focus=e.focus,this}},ta=class extends Di{constructor(e,t,n=0,s=Math.PI/3,r=0,a=2){super(e,t),this.isSpotLight=!0,this.type="SpotLight",this.position.copy(rt.DEFAULT_UP),this.updateMatrix(),this.target=new rt,this.distance=n,this.angle=s,this.penumbra=r,this.decay=a,this.map=null,this.shadow=new $l}get power(){return this.intensity*Math.PI}set power(e){this.intensity=e/Math.PI}dispose(){super.dispose(),this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.angle=e.angle,this.penumbra=e.penumbra,this.decay=e.decay,this.target=e.target.clone(),this.map=e.map,this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.distance=this.distance,t.object.angle=this.angle,t.object.decay=this.decay,t.object.penumbra=this.penumbra,t.object.target=this.target.uuid,this.map&&this.map.isTexture&&(t.object.map=this.map.toJSON(e).uuid),t.object.shadow=this.shadow.toJSON(),t}},Zl=class extends Qr{constructor(){super(new At(90,1,.5,500)),this.isPointLightShadow=!0}},na=class extends Di{constructor(e,t,n=0,s=2){super(e,t),this.isPointLight=!0,this.type="PointLight",this.distance=n,this.decay=s,this.shadow=new Zl}get power(){return this.intensity*4*Math.PI}set power(e){this.intensity=e/(4*Math.PI)}dispose(){super.dispose(),this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.decay=e.decay,this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.distance=this.distance,t.object.decay=this.decay,t.object.shadow=this.shadow.toJSON(),t}},Nn=class extends ea{constructor(e=-1,t=1,n=1,s=-1,r=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=s,this.near=r,this.far=a,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,s,r,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,s=(this.top+this.bottom)/2,r=n-e,a=n+e,o=s+t,c=s-t;if(this.view!==null&&this.view.enabled){let l=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=l*this.view.offsetX,a=r+l*this.view.width,o-=h*this.view.offsetY,c=o-h*this.view.height}this.projectionMatrix.makeOrthographic(r,a,o,c,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},Ql=class extends Qr{constructor(){super(new Nn(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},$n=class extends Di{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(rt.DEFAULT_UP),this.updateMatrix(),this.target=new rt,this.shadow=new Ql}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.shadow=this.shadow.toJSON(),t.object.target=this.target.uuid,t}},Ni=class extends Di{constructor(e,t){super(e,t),this.isAmbientLight=!0,this.type="AmbientLight"}},gi=class{static extractUrlBase(e){let t=e.lastIndexOf("/");return t===-1?"./":e.slice(0,t+1)}static resolveURL(e,t){return typeof e!="string"||e===""?"":(/^https?:\/\//i.test(t)&&/^\//.test(e)&&(t=t.replace(/(^https?:\/\/[^\/]+).*/i,"$1")),/^(https?:)?\/\//i.test(e)||/^data:.*,.*$/i.test(e)||/^blob:.*$/i.test(e)?e:t+e)}},Wl=new WeakMap,ia=class extends Jn{constructor(e){super(e),this.isImageBitmapLoader=!0,typeof createImageBitmap>"u"&&ye("ImageBitmapLoader: createImageBitmap() not supported."),typeof fetch>"u"&&ye("ImageBitmapLoader: fetch() not supported."),this.options={premultiplyAlpha:"none"},this._abortController=new AbortController}setOptions(e){return this.options=e,this}load(e,t,n,s){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let r=this,a=Xn.get(`image-bitmap:${e}`);if(a!==void 0){if(r.manager.itemStart(e),a.then){a.then(l=>{Wl.has(a)===!0?(s&&s(Wl.get(a)),r.manager.itemError(e),r.manager.itemEnd(e)):(t&&t(l),r.manager.itemEnd(e))});return}setTimeout(function(){t&&t(a),r.manager.itemEnd(e)},0);return}let o={};o.credentials=this.crossOrigin==="anonymous"?"same-origin":"include",o.headers=this.requestHeader,o.signal=typeof AbortSignal.any=="function"?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal;let c=fetch(e,o).then(function(l){return l.blob()}).then(function(l){return createImageBitmap(l,Object.assign(r.options,{colorSpaceConversion:"none"}))}).then(function(l){Xn.add(`image-bitmap:${e}`,l),t&&t(l),r.manager.itemEnd(e)}).catch(function(l){s&&s(l),Wl.set(c,l),Xn.remove(`image-bitmap:${e}`),r.manager.itemError(e),r.manager.itemEnd(e)});Xn.add(`image-bitmap:${e}`,c),r.manager.itemStart(e)}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}},zs=-90,Vs=1,Io=class extends rt{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;let s=new At(zs,Vs,e,t);s.layers=this.layers,this.add(s);let r=new At(zs,Vs,e,t);r.layers=this.layers,this.add(r);let a=new At(zs,Vs,e,t);a.layers=this.layers,this.add(a);let o=new At(zs,Vs,e,t);o.layers=this.layers,this.add(o);let c=new At(zs,Vs,e,t);c.layers=this.layers,this.add(c);let l=new At(zs,Vs,e,t);l.layers=this.layers,this.add(l)}updateCoordinateSystem(){let e=this.coordinateSystem,t=this.children.concat(),[n,s,r,a,o,c]=t;for(let l of t)this.remove(l);if(e===In)n.up.set(0,1,0),n.lookAt(1,0,0),s.up.set(0,1,0),s.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),c.up.set(0,1,0),c.lookAt(0,0,-1);else if(e===qs)n.up.set(0,-1,0),n.lookAt(-1,0,0),s.up.set(0,-1,0),s.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),c.up.set(0,-1,0),c.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let l of t)this.add(l),l.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();let{renderTarget:n,activeMipmapLevel:s}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[r,a,o,c,l,h]=this.children,u=e.getRenderTarget(),d=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),g=e.xr.enabled;e.xr.enabled=!1;let _=n.texture.generateMipmaps;n.texture.generateMipmaps=!1;let m=!1;e.isWebGLRenderer===!0?m=e.state.buffers.depth.getReversed():m=e.reversedDepthBuffer,e.setRenderTarget(n,0,s),m&&e.autoClear===!1&&e.clearDepth(),e.render(t,r),e.setRenderTarget(n,1,s),m&&e.autoClear===!1&&e.clearDepth(),e.render(t,a),e.setRenderTarget(n,2,s),m&&e.autoClear===!1&&e.clearDepth(),e.render(t,o),e.setRenderTarget(n,3,s),m&&e.autoClear===!1&&e.clearDepth(),e.render(t,c),e.setRenderTarget(n,4,s),m&&e.autoClear===!1&&e.clearDepth(),e.render(t,l),n.texture.generateMipmaps=_,e.setRenderTarget(n,5,s),m&&e.autoClear===!1&&e.clearDepth(),e.render(t,h),e.setRenderTarget(u,d,f),e.xr.enabled=g,n.texture.needsPMREMUpdate=!0}},ko=class extends At{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}},Ui=class{constructor(){this._previousTime=0,this._currentTime=0,this._startTime=performance.now(),this._delta=0,this._elapsed=0,this._timescale=1,this._document=null,this._pageVisibilityHandler=null}connect(e){this._document=e,e.hidden!==void 0&&(this._pageVisibilityHandler=X0.bind(this),e.addEventListener("visibilitychange",this._pageVisibilityHandler,!1))}disconnect(){this._pageVisibilityHandler!==null&&(this._document.removeEventListener("visibilitychange",this._pageVisibilityHandler),this._pageVisibilityHandler=null),this._document=null}getDelta(){return this._delta/1e3}getElapsed(){return this._elapsed/1e3}getTimescale(){return this._timescale}setTimescale(e){return this._timescale=e,this}reset(){return this._currentTime=performance.now()-this._startTime,this}dispose(){this.disconnect()}update(e){return this._pageVisibilityHandler!==null&&this._document.hidden===!0?this._delta=0:(this._previousTime=this._currentTime,this._currentTime=(e!==void 0?e:performance.now())-this._startTime,this._delta=(this._currentTime-this._previousTime)*this._timescale,this._elapsed+=this._delta),this}};Do=class{constructor(e,t,n){this.binding=e,this.valueSize=n;let s,r,a;switch(t){case"quaternion":s=this._slerp,r=this._slerpAdditive,a=this._setAdditiveIdentityQuaternion,this.buffer=new Float64Array(n*6),this._workIndex=5;break;case"string":case"bool":s=this._select,r=this._select,a=this._setAdditiveIdentityOther,this.buffer=new Array(n*5);break;default:s=this._lerp,r=this._lerpAdditive,a=this._setAdditiveIdentityNumeric,this.buffer=new Float64Array(n*5)}this._mixBufferRegion=s,this._mixBufferRegionAdditive=r,this._setIdentity=a,this._origIndex=3,this._addIndex=4,this.cumulativeWeight=0,this.cumulativeWeightAdditive=0,this.useCount=0,this.referenceCount=0}accumulate(e,t){let n=this.buffer,s=this.valueSize,r=e*s+s,a=this.cumulativeWeight;if(a===0){for(let o=0;o!==s;++o)n[r+o]=n[o];a=t}else{a+=t;let o=t/a;this._mixBufferRegion(n,r,0,o,s)}this.cumulativeWeight=a}accumulateAdditive(e){let t=this.buffer,n=this.valueSize,s=n*this._addIndex;this.cumulativeWeightAdditive===0&&this._setIdentity(),this._mixBufferRegionAdditive(t,s,0,e,n),this.cumulativeWeightAdditive+=e}apply(e){let t=this.valueSize,n=this.buffer,s=e*t+t,r=this.cumulativeWeight,a=this.cumulativeWeightAdditive,o=this.binding;if(this.cumulativeWeight=0,this.cumulativeWeightAdditive=0,r<1){let c=t*this._origIndex;this._mixBufferRegion(n,s,c,1-r,t)}a>0&&this._mixBufferRegionAdditive(n,s,this._addIndex*t,1,t);for(let c=t,l=t+t;c!==l;++c)if(n[c]!==n[c+t]){o.setValue(n,s);break}}saveOriginalState(){let e=this.binding,t=this.buffer,n=this.valueSize,s=n*this._origIndex;e.getValue(t,s);for(let r=n,a=s;r!==a;++r)t[r]=t[s+r%n];this._setIdentity(),this.cumulativeWeight=0,this.cumulativeWeightAdditive=0}restoreOriginalState(){let e=this.valueSize*3;this.binding.setValue(this.buffer,e)}_setAdditiveIdentityNumeric(){let e=this._addIndex*this.valueSize,t=e+this.valueSize;for(let n=e;n<t;n++)this.buffer[n]=0}_setAdditiveIdentityQuaternion(){this._setAdditiveIdentityNumeric(),this.buffer[this._addIndex*this.valueSize+3]=1}_setAdditiveIdentityOther(){let e=this._origIndex*this.valueSize,t=this._addIndex*this.valueSize;for(let n=0;n<this.valueSize;n++)this.buffer[t+n]=this.buffer[e+n]}_select(e,t,n,s,r){if(s>=.5)for(let a=0;a!==r;++a)e[t+a]=e[n+a]}_slerp(e,t,n,s){ge.slerpFlat(e,t,e,t,e,n,s)}_slerpAdditive(e,t,n,s,r){let a=this._workIndex*r;ge.multiplyQuaternionsFlat(e,a,e,t,e,n),ge.slerpFlat(e,t,e,t,e,a,s)}_lerp(e,t,n,s,r){let a=1-s;for(let o=0;o!==r;++o){let c=t+o;e[c]=e[c]*a+e[n+o]*s}}_lerpAdditive(e,t,n,s,r){for(let a=0;a!==r;++a){let o=t+a;e[o]=e[o]+e[n+a]*s}}},Eh="\\[\\]\\.:\\/",j0=new RegExp("["+Eh+"]","g"),Th="[^"+Eh+"]",Y0="[^"+Eh.replace("\\.","")+"]",K0=/((?:WC+[\/:])*)/.source.replace("WC",Th),J0=/(WCOD+)?/.source.replace("WCOD",Y0),$0=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Th),Z0=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Th),Q0=new RegExp("^"+K0+J0+$0+Z0+"$"),e_=["material","materials","bones","map"],eh=class{constructor(e,t,n){let s=n||it.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,s)}getValue(e,t){this.bind();let n=this._targetGroup.nCachedObjects_,s=this._bindings[n];s!==void 0&&s.getValue(e,t)}setValue(e,t){let n=this._bindings;for(let s=this._targetGroup.nCachedObjects_,r=n.length;s!==r;++s)n[s].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}},it=class i{constructor(e,t,n){this.path=t,this.parsedPath=n||i.parseTrackName(t),this.node=i.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,n){return e&&e.isAnimationObjectGroup?new i.Composite(e,t,n):new i(e,t,n)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(j0,"")}static parseTrackName(e){let t=Q0.exec(e);if(t===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},s=n.nodeName&&n.nodeName.lastIndexOf(".");if(s!==void 0&&s!==-1){let r=n.nodeName.substring(s+1);e_.indexOf(r)!==-1&&(n.nodeName=n.nodeName.substring(0,s),n.objectName=r)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return n}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){let n=function(r){for(let a=0;a<r.length;a++){let o=r[a];if(o.name===t||o.uuid===t)return o;let c=n(o.children);if(c)return c}return null},s=n(e.children);if(s)return s}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)e[t++]=n[s]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node,t=this.parsedPath,n=t.objectName,s=t.propertyName,r=t.propertyIndex;if(e||(e=i.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){ye("PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let l=t.objectIndex;switch(n){case"materials":if(!e.material){Te("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){Te("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){Te("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let h=0;h<e.length;h++)if(e[h].name===l){l=h;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){Te("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){Te("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[n]===void 0){Te("PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[n]}if(l!==void 0){if(e[l]===void 0){Te("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[l]}}let a=e[s];if(a===void 0){let l=t.nodeName;Te("PropertyBinding: Trying to update property for track: "+l+"."+s+" but it wasn't found.",e);return}let o=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?o=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(o=this.Versioning.MatrixWorldNeedsUpdate);let c=this.BindingType.Direct;if(r!==void 0){if(s==="morphTargetInfluences"){if(!e.geometry){Te("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){Te("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[r]!==void 0&&(r=e.morphTargetDictionary[r])}c=this.BindingType.ArrayElement,this.resolvedProperty=a,this.propertyIndex=r}else a.fromArray!==void 0&&a.toArray!==void 0?(c=this.BindingType.HasFromToArray,this.resolvedProperty=a):Array.isArray(a)?(c=this.BindingType.EntireArray,this.resolvedProperty=a):this.propertyName=s;this.getValue=this.GetterByBindingType[c],this.setValue=this.SetterByBindingTypeAndVersioning[c][o]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};it.Composite=eh;it.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};it.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};it.prototype.GetterByBindingType=[it.prototype._getValue_direct,it.prototype._getValue_array,it.prototype._getValue_arrayElement,it.prototype._getValue_toArray];it.prototype.SetterByBindingTypeAndVersioning=[[it.prototype._setValue_direct,it.prototype._setValue_direct_setNeedsUpdate,it.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[it.prototype._setValue_array,it.prototype._setValue_array_setNeedsUpdate,it.prototype._setValue_array_setMatrixWorldNeedsUpdate],[it.prototype._setValue_arrayElement,it.prototype._setValue_arrayElement_setNeedsUpdate,it.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[it.prototype._setValue_fromArray,it.prototype._setValue_fromArray_setNeedsUpdate,it.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];Fo=class{constructor(e,t,n=null,s=t.blendMode){this._mixer=e,this._clip=t,this._localRoot=n,this.blendMode=s;let r=t.tracks,a=r.length,o=new Array(a),c={endingStart:Zi,endingEnd:Zi};for(let l=0;l!==a;++l){let h=r[l].createInterpolant(null);o[l]=h,h.settings&&Object.assign(c,h.settings),h.settings=c}this._interpolantSettings=c,this._interpolants=o,this._propertyBindings=new Array(a),this._cacheIndex=null,this._byClipCacheIndex=null,this._timeScaleInterpolant=null,this._weightInterpolant=null,this.loop=ps,this._loopCount=-1,this._startTime=null,this.time=0,this.timeScale=1,this._effectiveTimeScale=1,this.weight=1,this._effectiveWeight=1,this.repetitions=1/0,this.paused=!1,this.enabled=!0,this.clampWhenFinished=!1,this.zeroSlopeAtStart=!0,this.zeroSlopeAtEnd=!0}play(){return this._mixer._activateAction(this),this}stop(){return this._mixer._deactivateAction(this),this.reset()}reset(){return this.paused=!1,this.enabled=!0,this.time=0,this._loopCount=-1,this._startTime=null,this.stopFading().stopWarping()}isRunning(){return this.enabled&&!this.paused&&this.timeScale!==0&&this._startTime===null&&this._mixer._isActiveAction(this)}isScheduled(){return this._mixer._isActiveAction(this)}startAt(e){return this._startTime=e,this}setLoop(e,t){return this.loop=e,this.repetitions=t,this}setEffectiveWeight(e){return this.weight=e,this._effectiveWeight=this.enabled?e:0,this.stopFading()}getEffectiveWeight(){return this._effectiveWeight}fadeIn(e){return this._scheduleFading(e,0,1)}fadeOut(e){return this._scheduleFading(e,1,0)}crossFadeFrom(e,t,n=!1){if(e.fadeOut(t),this.fadeIn(t),n===!0){let s=this._clip.duration,r=e._clip.duration,a=r/s,o=s/r;e.warp(1,a,t),this.warp(o,1,t)}return this}crossFadeTo(e,t,n=!1){return e.crossFadeFrom(this,t,n)}stopFading(){let e=this._weightInterpolant;return e!==null&&(this._weightInterpolant=null,this._mixer._takeBackControlInterpolant(e)),this}setEffectiveTimeScale(e){return this.timeScale=e,this._effectiveTimeScale=this.paused?0:e,this.stopWarping()}getEffectiveTimeScale(){return this._effectiveTimeScale}setDuration(e){return this.timeScale=this._clip.duration/e,this.stopWarping()}syncWith(e){return this.time=e.time,this.timeScale=e.timeScale,this.stopWarping()}halt(e){return this.warp(this._effectiveTimeScale,0,e)}warp(e,t,n){let s=this._mixer,r=s.time,a=this.timeScale,o=this._timeScaleInterpolant;o===null&&(o=s._lendControlInterpolant(),this._timeScaleInterpolant=o);let c=o.parameterPositions,l=o.sampleValues;return c[0]=r,c[1]=r+n,l[0]=e/a,l[1]=t/a,this}stopWarping(){let e=this._timeScaleInterpolant;return e!==null&&(this._timeScaleInterpolant=null,this._mixer._takeBackControlInterpolant(e)),this}getMixer(){return this._mixer}getClip(){return this._clip}getRoot(){return this._localRoot||this._mixer._root}_update(e,t,n,s){if(!this.enabled){this._updateWeight(e);return}let r=this._startTime;if(r!==null){let c=(e-r)*n;c<0||n===0?t=0:(this._startTime=null,t=n*c)}t*=this._updateTimeScale(e);let a=this._updateTime(t),o=this._updateWeight(e);if(o>0){let c=this._interpolants,l=this._propertyBindings;switch(this.blendMode){case da:for(let h=0,u=c.length;h!==u;++h)c[h].evaluate(a),l[h].accumulateAdditive(o);break;case Mc:default:for(let h=0,u=c.length;h!==u;++h)c[h].evaluate(a),l[h].accumulate(s,o)}}}_updateWeight(e){let t=0;if(this.enabled){t=this.weight;let n=this._weightInterpolant;if(n!==null){let s=n.evaluate(e)[0];t*=s,e>n.parameterPositions[1]&&(this.stopFading(),s===0&&(this.enabled=!1))}}return this._effectiveWeight=t,t}_updateTimeScale(e){let t=0;if(!this.paused){t=this.timeScale;let n=this._timeScaleInterpolant;if(n!==null){let s=n.evaluate(e)[0];t*=s,e>n.parameterPositions[1]&&(this.stopWarping(),t===0?this.paused=!0:this.timeScale=t)}}return this._effectiveTimeScale=t,t}_updateTime(e){let t=this._clip.duration,n=this.loop,s=this.time+e,r=this._loopCount,a=n===yf;if(e===0)return r===-1?s:a&&(r&1)===1?t-s:s;if(n===zi){r===-1&&(this._loopCount=0,this._setEndings(!0,!0,!1));e:{if(s>=t)s=t;else if(s<0)s=0;else{this.time=s;break e}this.clampWhenFinished?this.paused=!0:this.enabled=!1,this.time=s,this._mixer.dispatchEvent({type:"finished",action:this,direction:e<0?-1:1})}}else{if(r===-1&&(e>=0?(r=0,this._setEndings(!0,this.repetitions===0,a)):this._setEndings(this.repetitions===0,!0,a)),s>=t||s<0){let o=Math.floor(s/t);s-=t*o,r+=Math.abs(o);let c=this.repetitions-r;if(c<=0)this.clampWhenFinished?this.paused=!0:this.enabled=!1,s=e>0?t:0,this.time=s,this._mixer.dispatchEvent({type:"finished",action:this,direction:e>0?1:-1});else{if(c===1){let l=e<0;this._setEndings(l,!l,a)}else this._setEndings(!1,!1,a);this._loopCount=r,this.time=s,this._mixer.dispatchEvent({type:"loop",action:this,loopDelta:o})}}else this._loopCount=r,this.time=s;if(a&&(r&1)===1)return t-s}return s}_setEndings(e,t,n){let s=this._interpolantSettings;n?(s.endingStart=Qi,s.endingEnd=Qi):(e?s.endingStart=this.zeroSlopeAtStart?Qi:Zi:s.endingStart=Dr,t?s.endingEnd=this.zeroSlopeAtEnd?Qi:Zi:s.endingEnd=Dr)}_scheduleFading(e,t,n){let s=this._mixer,r=s.time,a=this._weightInterpolant;a===null&&(a=s._lendControlInterpolant(),this._weightInterpolant=a);let o=a.parameterPositions,c=a.sampleValues;return o[0]=r,c[0]=t,o[1]=r+e,c[1]=n,this}},t_=new Float32Array(1),us=class extends Fn{constructor(e){super(),this._root=e,this._initMemoryManager(),this._accuIndex=0,this.time=0,this.timeScale=1,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}_bindAction(e,t){let n=e._localRoot||this._root,s=e._clip.tracks,r=s.length,a=e._propertyBindings,o=e._interpolants,c=n.uuid,l=this._bindingsByRootAndName,h=l[c];h===void 0&&(h={},l[c]=h);for(let u=0;u!==r;++u){let d=s[u],f=d.name,g=h[f];if(g!==void 0)++g.referenceCount,a[u]=g;else{if(g=a[u],g!==void 0){g._cacheIndex===null&&(++g.referenceCount,this._addInactiveBinding(g,c,f));continue}let _=t&&t._propertyBindings[u].binding.parsedPath;g=new Do(it.create(n,f,_),d.ValueTypeName,d.getValueSize()),++g.referenceCount,this._addInactiveBinding(g,c,f),a[u]=g}o[u].resultBuffer=g.buffer}}_activateAction(e){if(!this._isActiveAction(e)){if(e._cacheIndex===null){let n=(e._localRoot||this._root).uuid,s=e._clip.uuid,r=this._actionsByClip[s];this._bindAction(e,r&&r.knownActions[0]),this._addInactiveAction(e,s,n)}let t=e._propertyBindings;for(let n=0,s=t.length;n!==s;++n){let r=t[n];r.useCount++===0&&(this._lendBinding(r),r.saveOriginalState())}this._lendAction(e)}}_deactivateAction(e){if(this._isActiveAction(e)){let t=e._propertyBindings;for(let n=0,s=t.length;n!==s;++n){let r=t[n];--r.useCount===0&&(r.restoreOriginalState(),this._takeBackBinding(r))}this._takeBackAction(e)}}_initMemoryManager(){this._actions=[],this._nActiveActions=0,this._actionsByClip={},this._bindings=[],this._nActiveBindings=0,this._bindingsByRootAndName={},this._controlInterpolants=[],this._nActiveControlInterpolants=0;let e=this;this.stats={actions:{get total(){return e._actions.length},get inUse(){return e._nActiveActions}},bindings:{get total(){return e._bindings.length},get inUse(){return e._nActiveBindings}},controlInterpolants:{get total(){return e._controlInterpolants.length},get inUse(){return e._nActiveControlInterpolants}}}}_isActiveAction(e){let t=e._cacheIndex;return t!==null&&t<this._nActiveActions}_addInactiveAction(e,t,n){let s=this._actions,r=this._actionsByClip,a=r[t];if(a===void 0)a={knownActions:[e],actionByRoot:{}},e._byClipCacheIndex=0,r[t]=a;else{let o=a.knownActions;e._byClipCacheIndex=o.length,o.push(e)}e._cacheIndex=s.length,s.push(e),a.actionByRoot[n]=e}_removeInactiveAction(e){let t=this._actions,n=t[t.length-1],s=e._cacheIndex;n._cacheIndex=s,t[s]=n,t.pop(),e._cacheIndex=null;let r=e._clip.uuid,a=this._actionsByClip,o=a[r],c=o.knownActions,l=c[c.length-1],h=e._byClipCacheIndex;l._byClipCacheIndex=h,c[h]=l,c.pop(),e._byClipCacheIndex=null;let u=o.actionByRoot,d=(e._localRoot||this._root).uuid;delete u[d],c.length===0&&delete a[r],this._removeInactiveBindingsForAction(e)}_removeInactiveBindingsForAction(e){let t=e._propertyBindings;for(let n=0,s=t.length;n!==s;++n){let r=t[n];--r.referenceCount===0&&this._removeInactiveBinding(r)}}_lendAction(e){let t=this._actions,n=e._cacheIndex,s=this._nActiveActions++,r=t[s];e._cacheIndex=s,t[s]=e,r._cacheIndex=n,t[n]=r}_takeBackAction(e){let t=this._actions,n=e._cacheIndex,s=--this._nActiveActions,r=t[s];e._cacheIndex=s,t[s]=e,r._cacheIndex=n,t[n]=r}_addInactiveBinding(e,t,n){let s=this._bindingsByRootAndName,r=this._bindings,a=s[t];a===void 0&&(a={},s[t]=a),a[n]=e,e._cacheIndex=r.length,r.push(e)}_removeInactiveBinding(e){let t=this._bindings,n=e.binding,s=n.rootNode.uuid,r=n.path,a=this._bindingsByRootAndName,o=a[s],c=t[t.length-1],l=e._cacheIndex;c._cacheIndex=l,t[l]=c,t.pop(),delete o[r],Object.keys(o).length===0&&delete a[s]}_lendBinding(e){let t=this._bindings,n=e._cacheIndex,s=this._nActiveBindings++,r=t[s];e._cacheIndex=s,t[s]=e,r._cacheIndex=n,t[n]=r}_takeBackBinding(e){let t=this._bindings,n=e._cacheIndex,s=--this._nActiveBindings,r=t[s];e._cacheIndex=s,t[s]=e,r._cacheIndex=n,t[n]=r}_lendControlInterpolant(){let e=this._controlInterpolants,t=this._nActiveControlInterpolants++,n=e[t];return n===void 0&&(n=new Jr(new Float32Array(2),new Float32Array(2),1,t_),n.__cacheIndex=t,e[t]=n),n}_takeBackControlInterpolant(e){let t=this._controlInterpolants,n=e.__cacheIndex,s=--this._nActiveControlInterpolants,r=t[s];e.__cacheIndex=s,t[s]=e,r.__cacheIndex=n,t[n]=r}clipAction(e,t,n){let s=t||this._root,r=s.uuid,a=typeof e=="string"?$t.findByName(s,e):e,o=a!==null?a.uuid:e,c=this._actionsByClip[o],l=null;if(n===void 0&&(a!==null?n=a.blendMode:n=Mc),c!==void 0){let u=c.actionByRoot[r];if(u!==void 0&&u.blendMode===n)return u;l=c.knownActions[0],a===null&&(a=l._clip)}if(a===null)return null;let h=new Fo(this,a,t,n);return this._bindAction(h,l),this._addInactiveAction(h,o,r),h}existingAction(e,t){let n=t||this._root,s=n.uuid,r=typeof e=="string"?$t.findByName(n,e):e,a=r?r.uuid:e,o=this._actionsByClip[a];return o!==void 0&&o.actionByRoot[s]||null}stopAllAction(){let e=this._actions,t=this._nActiveActions;for(let n=t-1;n>=0;--n)e[n].stop();return this}update(e){e*=this.timeScale;let t=this._actions,n=this._nActiveActions,s=this.time+=e,r=Math.sign(e),a=this._accuIndex^=1;for(let l=0;l!==n;++l)t[l]._update(s,e,r,a);let o=this._bindings,c=this._nActiveBindings;for(let l=0;l!==c;++l)o[l].apply(a);return this}setTime(e){this.time=0;for(let t=0;t<this._actions.length;t++)this._actions[t].time=0;return this.update(e)}getRoot(){return this._root}uncacheClip(e){let t=this._actions,n=e.uuid,s=this._actionsByClip,r=s[n];if(r!==void 0){let a=r.knownActions;for(let o=0,c=a.length;o!==c;++o){let l=a[o];this._deactivateAction(l);let h=l._cacheIndex,u=t[t.length-1];l._cacheIndex=null,l._byClipCacheIndex=null,u._cacheIndex=h,t[h]=u,t.pop(),this._removeInactiveBindingsForAction(l)}delete s[n]}}uncacheRoot(e){let t=e.uuid,n=this._actionsByClip;for(let a in n){let o=n[a].actionByRoot,c=o[t];c!==void 0&&(this._deactivateAction(c),this._removeInactiveAction(c))}let s=this._bindingsByRootAndName,r=s[t];if(r!==void 0)for(let a in r){let o=r[a];o.restoreOriginalState(),this._removeInactiveBinding(o)}}uncacheAction(e,t){let n=this.existingAction(e,t);n!==null&&(this._deactivateAction(n),this._removeInactiveAction(n))}},rr=class{constructor(e,t,n,s,r,a=!1){this.isGLBufferAttribute=!0,this.name="",this.buffer=e,this.type=t,this.itemSize=n,this.elementSize=s,this.count=r,this.normalized=a,this.version=0}set needsUpdate(e){e===!0&&this.version++}setBuffer(e){return this.buffer=e,this}setType(e,t){return this.type=e,this.elementSize=t,this}setItemSize(e){return this.itemSize=e,this}setCount(e){return this.count=e,this}},kh=class kh{constructor(e,t,n,s){this.elements=[1,0,0,1],e!==void 0&&this.set(e,t,n,s)}identity(){return this.set(1,0,0,1),this}fromArray(e,t=0){for(let n=0;n<4;n++)this.elements[n]=e[n+t];return this}set(e,t,n,s){let r=this.elements;return r[0]=e,r[2]=t,r[1]=n,r[3]=s,this}};kh.prototype.isMatrix2=!0;th=kh;typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:"184"}}));typeof window<"u"&&(window.__THREE__?ye("WARNING: Multiple instances of Three.js being imported."):window.__THREE__="184")});function op(){let i=null,e=!1,t=null,n=null;function s(r,a){t(r,a),n=i.requestAnimationFrame(s)}return{start:function(){e!==!0&&t!==null&&i!==null&&(n=i.requestAnimationFrame(s),e=!0)},stop:function(){i!==null&&i.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(r){t=r},setContext:function(r){i=r}}}function s_(i){let e=new WeakMap;function t(o,c){let l=o.array,h=o.usage,u=l.byteLength,d=i.createBuffer();i.bindBuffer(c,d),i.bufferData(c,l,h),o.onUploadCallback();let f;if(l instanceof Float32Array)f=i.FLOAT;else if(typeof Float16Array<"u"&&l instanceof Float16Array)f=i.HALF_FLOAT;else if(l instanceof Uint16Array)o.isFloat16BufferAttribute?f=i.HALF_FLOAT:f=i.UNSIGNED_SHORT;else if(l instanceof Int16Array)f=i.SHORT;else if(l instanceof Uint32Array)f=i.UNSIGNED_INT;else if(l instanceof Int32Array)f=i.INT;else if(l instanceof Int8Array)f=i.BYTE;else if(l instanceof Uint8Array)f=i.UNSIGNED_BYTE;else if(l instanceof Uint8ClampedArray)f=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+l);return{buffer:d,type:f,bytesPerElement:l.BYTES_PER_ELEMENT,version:o.version,size:u}}function n(o,c,l){let h=c.array,u=c.updateRanges;if(i.bindBuffer(l,o),u.length===0)i.bufferSubData(l,0,h);else{u.sort((f,g)=>f.start-g.start);let d=0;for(let f=1;f<u.length;f++){let g=u[d],_=u[f];_.start<=g.start+g.count+1?g.count=Math.max(g.count,_.start+_.count-g.start):(++d,u[d]=_)}u.length=d+1;for(let f=0,g=u.length;f<g;f++){let _=u[f];i.bufferSubData(l,_.start*h.BYTES_PER_ELEMENT,h,_.start,_.count)}c.clearUpdateRanges()}c.onUploadCallback()}function s(o){return o.isInterleavedBufferAttribute&&(o=o.data),e.get(o)}function r(o){o.isInterleavedBufferAttribute&&(o=o.data);let c=e.get(o);c&&(i.deleteBuffer(c.buffer),e.delete(o))}function a(o,c){if(o.isInterleavedBufferAttribute&&(o=o.data),o.isGLBufferAttribute){let h=e.get(o);(!h||h.version<o.version)&&e.set(o,{buffer:o.buffer,type:o.type,bytesPerElement:o.elementSize,version:o.version});return}let l=e.get(o);if(l===void 0)e.set(o,t(o,c));else if(l.version<o.version){if(l.size!==o.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(l.buffer,o,c),l.version=o.version}}return{get:s,remove:r,update:a}}function Hx(i,e,t,n,s,r){let a=new Ee(0),o=s===!0?0:1,c,l,h=null,u=0,d=null;function f(x){let y=x.isScene===!0?x.background:null;if(y&&y.isTexture){let w=x.backgroundBlurriness>0;y=e.get(y,w)}return y}function g(x){let y=!1,w=f(x);w===null?m(a,o):w&&w.isColor&&(m(w,1),y=!0);let A=i.xr.getEnvironmentBlendMode();A==="additive"?t.buffers.color.setClear(0,0,0,1,r):A==="alpha-blend"&&t.buffers.color.setClear(0,0,0,0,r),(i.autoClear||y)&&(t.buffers.depth.setTest(!0),t.buffers.depth.setMask(!0),t.buffers.color.setMask(!0),i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil))}function _(x,y){let w=f(y);w&&(w.isCubeTexture||w.mapping===ra)?(l===void 0&&(l=new It(new ir(1,1,1),new pn({name:"BackgroundCubeMaterial",uniforms:ms(ti.backgroundCube.uniforms),vertexShader:ti.backgroundCube.vertexShader,fragmentShader:ti.backgroundCube.fragmentShader,side:Zt,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),l.geometry.deleteAttribute("uv"),l.onBeforeRender=function(A,S,R){this.matrixWorld.copyPosition(R.matrixWorld)},Object.defineProperty(l.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),n.update(l)),l.material.uniforms.envMap.value=w,l.material.uniforms.backgroundBlurriness.value=y.backgroundBlurriness,l.material.uniforms.backgroundIntensity.value=y.backgroundIntensity,l.material.uniforms.backgroundRotation.value.setFromMatrix4(Bx.makeRotationFromEuler(y.backgroundRotation)).transpose(),w.isCubeTexture&&w.isRenderTargetTexture===!1&&l.material.uniforms.backgroundRotation.value.premultiply(cp),l.material.toneMapped=ze.getTransfer(w.colorSpace)!==$e,(h!==w||u!==w.version||d!==i.toneMapping)&&(l.material.needsUpdate=!0,h=w,u=w.version,d=i.toneMapping),l.layers.enableAll(),x.unshift(l,l.geometry,l.material,0,0,null)):w&&w.isTexture&&(c===void 0&&(c=new It(new Yr(2,2),new pn({name:"BackgroundMaterial",uniforms:ms(ti.background.uniforms),vertexShader:ti.background.vertexShader,fragmentShader:ti.background.fragmentShader,side:Dn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),n.update(c)),c.material.uniforms.t2D.value=w,c.material.uniforms.backgroundIntensity.value=y.backgroundIntensity,c.material.toneMapped=ze.getTransfer(w.colorSpace)!==$e,w.matrixAutoUpdate===!0&&w.updateMatrix(),c.material.uniforms.uvTransform.value.copy(w.matrix),(h!==w||u!==w.version||d!==i.toneMapping)&&(c.material.needsUpdate=!0,h=w,u=w.version,d=i.toneMapping),c.layers.enableAll(),x.unshift(c,c.geometry,c.material,0,0,null))}function m(x,y){x.getRGB(Tc,Sh(i)),t.buffers.color.setClear(Tc.r,Tc.g,Tc.b,y,r)}function p(){l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0),c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0)}return{getClearColor:function(){return a},setClearColor:function(x,y=1){a.set(x),o=y,m(a,o)},getClearAlpha:function(){return o},setClearAlpha:function(x){o=x,m(a,o)},render:g,addToRenderList:_,dispose:p}}function zx(i,e){let t=i.getParameter(i.MAX_VERTEX_ATTRIBS),n={},s=d(null),r=s,a=!1;function o(C,N,G,q,F){let H=!1,V=u(C,q,G,N);r!==V&&(r=V,l(r.object)),H=f(C,q,G,F),H&&g(C,q,G,F),F!==null&&e.update(F,i.ELEMENT_ARRAY_BUFFER),(H||a)&&(a=!1,w(C,N,G,q),F!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,e.get(F).buffer))}function c(){return i.createVertexArray()}function l(C){return i.bindVertexArray(C)}function h(C){return i.deleteVertexArray(C)}function u(C,N,G,q){let F=q.wireframe===!0,H=n[N.id];H===void 0&&(H={},n[N.id]=H);let V=C.isInstancedMesh===!0?C.id:0,Z=H[V];Z===void 0&&(Z={},H[V]=Z);let Q=Z[G.id];Q===void 0&&(Q={},Z[G.id]=Q);let le=Q[F];return le===void 0&&(le=d(c()),Q[F]=le),le}function d(C){let N=[],G=[],q=[];for(let F=0;F<t;F++)N[F]=0,G[F]=0,q[F]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:N,enabledAttributes:G,attributeDivisors:q,object:C,attributes:{},index:null}}function f(C,N,G,q){let F=r.attributes,H=N.attributes,V=0,Z=G.getAttributes();for(let Q in Z)if(Z[Q].location>=0){let xe=F[Q],Se=H[Q];if(Se===void 0&&(Q==="instanceMatrix"&&C.instanceMatrix&&(Se=C.instanceMatrix),Q==="instanceColor"&&C.instanceColor&&(Se=C.instanceColor)),xe===void 0||xe.attribute!==Se||Se&&xe.data!==Se.data)return!0;V++}return r.attributesNum!==V||r.index!==q}function g(C,N,G,q){let F={},H=N.attributes,V=0,Z=G.getAttributes();for(let Q in Z)if(Z[Q].location>=0){let xe=H[Q];xe===void 0&&(Q==="instanceMatrix"&&C.instanceMatrix&&(xe=C.instanceMatrix),Q==="instanceColor"&&C.instanceColor&&(xe=C.instanceColor));let Se={};Se.attribute=xe,xe&&xe.data&&(Se.data=xe.data),F[Q]=Se,V++}r.attributes=F,r.attributesNum=V,r.index=q}function _(){let C=r.newAttributes;for(let N=0,G=C.length;N<G;N++)C[N]=0}function m(C){p(C,0)}function p(C,N){let G=r.newAttributes,q=r.enabledAttributes,F=r.attributeDivisors;G[C]=1,q[C]===0&&(i.enableVertexAttribArray(C),q[C]=1),F[C]!==N&&(i.vertexAttribDivisor(C,N),F[C]=N)}function x(){let C=r.newAttributes,N=r.enabledAttributes;for(let G=0,q=N.length;G<q;G++)N[G]!==C[G]&&(i.disableVertexAttribArray(G),N[G]=0)}function y(C,N,G,q,F,H,V){V===!0?i.vertexAttribIPointer(C,N,G,F,H):i.vertexAttribPointer(C,N,G,q,F,H)}function w(C,N,G,q){_();let F=q.attributes,H=G.getAttributes(),V=N.defaultAttributeValues;for(let Z in H){let Q=H[Z];if(Q.location>=0){let le=F[Z];if(le===void 0&&(Z==="instanceMatrix"&&C.instanceMatrix&&(le=C.instanceMatrix),Z==="instanceColor"&&C.instanceColor&&(le=C.instanceColor)),le!==void 0){let xe=le.normalized,Se=le.itemSize,Ye=e.get(le);if(Ye===void 0)continue;let Qe=Ye.buffer,Ue=Ye.type,K=Ye.bytesPerElement,de=Ue===i.INT||Ue===i.UNSIGNED_INT||le.gpuType===Ho;if(le.isInterleavedBufferAttribute){let ie=le.data,Re=ie.stride,De=le.offset;if(ie.isInstancedInterleavedBuffer){for(let Ce=0;Ce<Q.locationSize;Ce++)p(Q.location+Ce,ie.meshPerAttribute);C.isInstancedMesh!==!0&&q._maxInstanceCount===void 0&&(q._maxInstanceCount=ie.meshPerAttribute*ie.count)}else for(let Ce=0;Ce<Q.locationSize;Ce++)m(Q.location+Ce);i.bindBuffer(i.ARRAY_BUFFER,Qe);for(let Ce=0;Ce<Q.locationSize;Ce++)y(Q.location+Ce,Se/Q.locationSize,Ue,xe,Re*K,(De+Se/Q.locationSize*Ce)*K,de)}else{if(le.isInstancedBufferAttribute){for(let ie=0;ie<Q.locationSize;ie++)p(Q.location+ie,le.meshPerAttribute);C.isInstancedMesh!==!0&&q._maxInstanceCount===void 0&&(q._maxInstanceCount=le.meshPerAttribute*le.count)}else for(let ie=0;ie<Q.locationSize;ie++)m(Q.location+ie);i.bindBuffer(i.ARRAY_BUFFER,Qe);for(let ie=0;ie<Q.locationSize;ie++)y(Q.location+ie,Se/Q.locationSize,Ue,xe,Se*K,Se/Q.locationSize*ie*K,de)}}else if(V!==void 0){let xe=V[Z];if(xe!==void 0)switch(xe.length){case 2:i.vertexAttrib2fv(Q.location,xe);break;case 3:i.vertexAttrib3fv(Q.location,xe);break;case 4:i.vertexAttrib4fv(Q.location,xe);break;default:i.vertexAttrib1fv(Q.location,xe)}}}}x()}function A(){T();for(let C in n){let N=n[C];for(let G in N){let q=N[G];for(let F in q){let H=q[F];for(let V in H)h(H[V].object),delete H[V];delete q[F]}}delete n[C]}}function S(C){if(n[C.id]===void 0)return;let N=n[C.id];for(let G in N){let q=N[G];for(let F in q){let H=q[F];for(let V in H)h(H[V].object),delete H[V];delete q[F]}}delete n[C.id]}function R(C){for(let N in n){let G=n[N];for(let q in G){let F=G[q];if(F[C.id]===void 0)continue;let H=F[C.id];for(let V in H)h(H[V].object),delete H[V];delete F[C.id]}}}function b(C){for(let N in n){let G=n[N],q=C.isInstancedMesh===!0?C.id:0,F=G[q];if(F!==void 0){for(let H in F){let V=F[H];for(let Z in V)h(V[Z].object),delete V[Z];delete F[H]}delete G[q],Object.keys(G).length===0&&delete n[N]}}}function T(){P(),a=!0,r!==s&&(r=s,l(r.object))}function P(){s.geometry=null,s.program=null,s.wireframe=!1}return{setup:o,reset:T,resetDefaultState:P,dispose:A,releaseStatesOfGeometry:S,releaseStatesOfObject:b,releaseStatesOfProgram:R,initAttributes:_,enableAttribute:m,disableUnusedAttributes:x}}function Vx(i,e,t){let n;function s(c){n=c}function r(c,l){i.drawArrays(n,c,l),t.update(l,n,1)}function a(c,l,h){h!==0&&(i.drawArraysInstanced(n,c,l,h),t.update(l,n,h))}function o(c,l,h){if(h===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,c,0,l,0,h);let d=0;for(let f=0;f<h;f++)d+=l[f];t.update(d,n,1)}this.setMode=s,this.render=r,this.renderInstances=a,this.renderMultiDraw=o}function Gx(i,e,t,n){let s;function r(){if(s!==void 0)return s;if(e.has("EXT_texture_filter_anisotropic")===!0){let R=e.get("EXT_texture_filter_anisotropic");s=i.getParameter(R.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else s=0;return s}function a(R){return!(R!==gn&&n.convert(R)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_FORMAT))}function o(R){let b=R===Qn&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(R!==an&&n.convert(R)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_TYPE)&&R!==mn&&!b)}function c(R){if(R==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";R="mediump"}return R==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let l=t.precision!==void 0?t.precision:"highp",h=c(l);h!==l&&(ye("WebGLRenderer:",l,"not supported, using",h,"instead."),l=h);let u=t.logarithmicDepthBuffer===!0,d=t.reversedDepthBuffer===!0&&e.has("EXT_clip_control");t.reversedDepthBuffer===!0&&d===!1&&ye("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");let f=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),g=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),_=i.getParameter(i.MAX_TEXTURE_SIZE),m=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),p=i.getParameter(i.MAX_VERTEX_ATTRIBS),x=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),y=i.getParameter(i.MAX_VARYING_VECTORS),w=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),A=i.getParameter(i.MAX_SAMPLES),S=i.getParameter(i.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:c,textureFormatReadable:a,textureTypeReadable:o,precision:l,logarithmicDepthBuffer:u,reversedDepthBuffer:d,maxTextures:f,maxVertexTextures:g,maxTextureSize:_,maxCubemapSize:m,maxAttributes:p,maxVertexUniforms:x,maxVaryings:y,maxFragmentUniforms:w,maxSamples:A,samples:S}}function Wx(i){let e=this,t=null,n=0,s=!1,r=!1,a=new qn,o=new ke,c={value:null,needsUpdate:!1};this.uniform=c,this.numPlanes=0,this.numIntersection=0,this.init=function(u,d){let f=u.length!==0||d||n!==0||s;return s=d,n=u.length,f},this.beginShadows=function(){r=!0,h(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(u,d){t=h(u,d,0)},this.setState=function(u,d,f){let g=u.clippingPlanes,_=u.clipIntersection,m=u.clipShadows,p=i.get(u);if(!s||g===null||g.length===0||r&&!m)r?h(null):l();else{let x=r?0:n,y=x*4,w=p.clippingState||null;c.value=w,w=h(g,d,y,f);for(let A=0;A!==y;++A)w[A]=t[A];p.clippingState=w,this.numIntersection=_?this.numPlanes:0,this.numPlanes+=x}};function l(){c.value!==t&&(c.value=t,c.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function h(u,d,f,g){let _=u!==null?u.length:0,m=null;if(_!==0){if(m=c.value,g!==!0||m===null){let p=f+_*4,x=d.matrixWorldInverse;o.getNormalMatrix(x),(m===null||m.length<p)&&(m=new Float32Array(p));for(let y=0,w=f;y!==_;++y,w+=4)a.copy(u[y]).applyMatrix4(x,o),a.normal.toArray(m,w),m[w+3]=a.constant}c.value=m,c.needsUpdate=!0}return e.numPlanes=_,e.numIntersection=0,m}}function jx(i){let e=[],t=[],n=[],s=i,r=i-Vi+1+Bf.length;for(let a=0;a<r;a++){let o=Math.pow(2,s);e.push(o);let c=1/o;a>i-Vi?c=Bf[a-i+Vi-1]:a===0&&(c=0),t.push(c);let l=1/(o-2),h=-l,u=1+l,d=[h,h,u,h,u,u,h,h,u,u,h,u],f=6,g=6,_=3,m=2,p=1,x=new Float32Array(_*g*f),y=new Float32Array(m*g*f),w=new Float32Array(p*g*f);for(let S=0;S<f;S++){let R=S%3*2/3-1,b=S>2?0:-1,T=[R,b,0,R+2/3,b,0,R+2/3,b+1,0,R,b,0,R+2/3,b+1,0,R,b+1,0];x.set(T,_*g*S),y.set(d,m*g*S);let P=[S,S,S,S,S,S];w.set(P,p*g*S)}let A=new Xt;A.setAttribute("position",new Et(x,_)),A.setAttribute("uv",new Et(y,m)),A.setAttribute("faceIndex",new Et(w,p)),n.push(new It(A,null)),s>Vi&&s--}return{lodMeshes:n,sizeLods:e,sigmas:t}}function zf(i,e,t){let n=new dn(i,e,t);return n.texture.mapping=ra,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function ur(i,e,t,n,s){i.viewport.set(e,t,n,s),i.scissor.set(e,t,n,s)}function Yx(i,e,t){return new pn({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:qx,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:Pc(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float roughness;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359

			// Van der Corput radical inverse
			float radicalInverse_VdC(uint bits) {
				bits = (bits << 16u) | (bits >> 16u);
				bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
				bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
				bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
				bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
				return float(bits) * 2.3283064365386963e-10; // / 0x100000000
			}

			// Hammersley sequence
			vec2 hammersley(uint i, uint N) {
				return vec2(float(i) / float(N), radicalInverse_VdC(i));
			}

			// GGX VNDF importance sampling (Eric Heitz 2018)
			// "Sampling the GGX Distribution of Visible Normals"
			// https://jcgt.org/published/0007/04/01/
			vec3 importanceSampleGGX_VNDF(vec2 Xi, vec3 V, float roughness) {
				float alpha = roughness * roughness;

				// Section 4.1: Orthonormal basis
				vec3 T1 = vec3(1.0, 0.0, 0.0);
				vec3 T2 = cross(V, T1);

				// Section 4.2: Parameterization of projected area
				float r = sqrt(Xi.x);
				float phi = 2.0 * PI * Xi.y;
				float t1 = r * cos(phi);
				float t2 = r * sin(phi);
				float s = 0.5 * (1.0 + V.z);
				t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

				// Section 4.3: Reprojection onto hemisphere
				vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;

				// Section 3.4: Transform back to ellipsoid configuration
				return normalize(vec3(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
			}

			void main() {
				vec3 N = normalize(vOutputDirection);
				vec3 V = N; // Assume view direction equals normal for pre-filtering

				vec3 prefilteredColor = vec3(0.0);
				float totalWeight = 0.0;

				// For very low roughness, just sample the environment directly
				if (roughness < 0.001) {
					gl_FragColor = vec4(bilinearCubeUV(envMap, N, mipInt), 1.0);
					return;
				}

				// Tangent space basis for VNDF sampling
				vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
				vec3 tangent = normalize(cross(up, N));
				vec3 bitangent = cross(N, tangent);

				for(uint i = 0u; i < uint(GGX_SAMPLES); i++) {
					vec2 Xi = hammersley(i, uint(GGX_SAMPLES));

					// For PMREM, V = N, so in tangent space V is always (0, 0, 1)
					vec3 H_tangent = importanceSampleGGX_VNDF(Xi, vec3(0.0, 0.0, 1.0), roughness);

					// Transform H back to world space
					vec3 H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
					vec3 L = normalize(2.0 * dot(V, H) * H - V);

					float NdotL = max(dot(N, L), 0.0);

					if(NdotL > 0.0) {
						// Sample environment at fixed mip level
						// VNDF importance sampling handles the distribution filtering
						vec3 sampleColor = bilinearCubeUV(envMap, L, mipInt);

						// Weight by NdotL for the split-sum approximation
						// VNDF PDF naturally accounts for the visible microfacet distribution
						prefilteredColor += sampleColor * NdotL;
						totalWeight += NdotL;
					}
				}

				if (totalWeight > 0.0) {
					prefilteredColor = prefilteredColor / totalWeight;
				}

				gl_FragColor = vec4(prefilteredColor, 1.0);
			}
		`,blending:Zn,depthTest:!1,depthWrite:!1})}function Kx(i,e,t){let n=new Float32Array(gs),s=new L(0,1,0);return new pn({name:"SphericalGaussianBlur",defines:{n:gs,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:s}},vertexShader:Pc(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:Zn,depthTest:!1,depthWrite:!1})}function Vf(){return new pn({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Pc(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Zn,depthTest:!1,depthWrite:!1})}function Gf(){return new pn({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Pc(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Zn,depthTest:!1,depthWrite:!1})}function Pc(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function Jx(i){let e=new WeakMap,t=new WeakMap,n=null;function s(d,f=!1){return d==null?null:f?a(d):r(d)}function r(d){if(d&&d.isTexture){let f=d.mapping;if(f===Uo||f===Oo)if(e.has(d)){let g=e.get(d).texture;return o(g,d.mapping)}else{let g=d.image;if(g&&g.height>0){let _=new Lc(g.height);return _.fromEquirectangularTexture(i,d),e.set(d,_),d.addEventListener("dispose",l),o(_.texture,d.mapping)}else return null}}return d}function a(d){if(d&&d.isTexture){let f=d.mapping,g=f===Uo||f===Oo,_=f===Oi||f===ds;if(g||_){let m=t.get(d),p=m!==void 0?m.texture.pmremVersion:0;if(d.isRenderTargetTexture&&d.pmremVersion!==p)return n===null&&(n=new Cc(i)),m=g?n.fromEquirectangular(d,m):n.fromCubemap(d,m),m.texture.pmremVersion=d.pmremVersion,t.set(d,m),m.texture;if(m!==void 0)return m.texture;{let x=d.image;return g&&x&&x.height>0||_&&x&&c(x)?(n===null&&(n=new Cc(i)),m=g?n.fromEquirectangular(d):n.fromCubemap(d),m.texture.pmremVersion=d.pmremVersion,t.set(d,m),d.addEventListener("dispose",h),m.texture):null}}}return d}function o(d,f){return f===Uo?d.mapping=Oi:f===Oo&&(d.mapping=ds),d}function c(d){let f=0,g=6;for(let _=0;_<g;_++)d[_]!==void 0&&f++;return f===g}function l(d){let f=d.target;f.removeEventListener("dispose",l);let g=e.get(f);g!==void 0&&(e.delete(f),g.dispose())}function h(d){let f=d.target;f.removeEventListener("dispose",h);let g=t.get(f);g!==void 0&&(t.delete(f),g.dispose())}function u(){e=new WeakMap,t=new WeakMap,n!==null&&(n.dispose(),n=null)}return{get:s,dispose:u}}function $x(i){let e={};function t(n){if(e[n]!==void 0)return e[n];let s=i.getExtension(n);return e[n]=s,s}return{has:function(n){return t(n)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(n){let s=t(n);return s===null&&go("WebGLRenderer: "+n+" extension not supported."),s}}}function Zx(i,e,t,n){let s={},r=new WeakMap;function a(u){let d=u.target;d.index!==null&&e.remove(d.index);for(let g in d.attributes)e.remove(d.attributes[g]);d.removeEventListener("dispose",a),delete s[d.id];let f=r.get(d);f&&(e.remove(f),r.delete(d)),n.releaseStatesOfGeometry(d),d.isInstancedBufferGeometry===!0&&delete d._maxInstanceCount,t.memory.geometries--}function o(u,d){return s[d.id]===!0||(d.addEventListener("dispose",a),s[d.id]=!0,t.memory.geometries++),d}function c(u){let d=u.attributes;for(let f in d)e.update(d[f],i.ARRAY_BUFFER)}function l(u){let d=[],f=u.index,g=u.attributes.position,_=0;if(g===void 0)return;if(f!==null){let x=f.array;_=f.version;for(let y=0,w=x.length;y<w;y+=3){let A=x[y+0],S=x[y+1],R=x[y+2];d.push(A,S,S,R,R,A)}}else{let x=g.array;_=g.version;for(let y=0,w=x.length/3-1;y<w;y+=3){let A=y+0,S=y+1,R=y+2;d.push(A,S,S,R,R,A)}}let m=new(g.count>=65535?Hr:Br)(d,1);m.version=_;let p=r.get(u);p&&e.remove(p),r.set(u,m)}function h(u){let d=r.get(u);if(d){let f=u.index;f!==null&&d.version<f.version&&l(u)}else l(u);return r.get(u)}return{get:o,update:c,getWireframeAttribute:h}}function Qx(i,e,t){let n;function s(u){n=u}let r,a;function o(u){r=u.type,a=u.bytesPerElement}function c(u,d){i.drawElements(n,d,r,u*a),t.update(d,n,1)}function l(u,d,f){f!==0&&(i.drawElementsInstanced(n,d,r,u*a,f),t.update(d,n,f))}function h(u,d,f){if(f===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,d,0,r,u,0,f);let _=0;for(let m=0;m<f;m++)_+=d[m];t.update(_,n,1)}this.setMode=s,this.setIndex=o,this.render=c,this.renderInstances=l,this.renderMultiDraw=h}function ev(i){let e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,a,o){switch(t.calls++,a){case i.TRIANGLES:t.triangles+=o*(r/3);break;case i.LINES:t.lines+=o*(r/2);break;case i.LINE_STRIP:t.lines+=o*(r-1);break;case i.LINE_LOOP:t.lines+=o*r;break;case i.POINTS:t.points+=o*r;break;default:Te("WebGLInfo: Unknown draw mode:",a);break}}function s(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:s,update:n}}function tv(i,e,t){let n=new WeakMap,s=new st;function r(a,o,c){let l=a.morphTargetInfluences,h=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,u=h!==void 0?h.length:0,d=n.get(o);if(d===void 0||d.count!==u){let T=function(){R.dispose(),n.delete(o),o.removeEventListener("dispose",T)};d!==void 0&&d.texture.dispose();let f=o.morphAttributes.position!==void 0,g=o.morphAttributes.normal!==void 0,_=o.morphAttributes.color!==void 0,m=o.morphAttributes.position||[],p=o.morphAttributes.normal||[],x=o.morphAttributes.color||[],y=0;f===!0&&(y=1),g===!0&&(y=2),_===!0&&(y=3);let w=o.attributes.position.count*y,A=1;w>e.maxTextureSize&&(A=Math.ceil(w/e.maxTextureSize),w=e.maxTextureSize);let S=new Float32Array(w*A*4*u),R=new Ur(S,w,A,u);R.type=mn,R.needsUpdate=!0;let b=y*4;for(let P=0;P<u;P++){let C=m[P],N=p[P],G=x[P],q=w*A*4*P;for(let F=0;F<C.count;F++){let H=F*b;f===!0&&(s.fromBufferAttribute(C,F),S[q+H+0]=s.x,S[q+H+1]=s.y,S[q+H+2]=s.z,S[q+H+3]=0),g===!0&&(s.fromBufferAttribute(N,F),S[q+H+4]=s.x,S[q+H+5]=s.y,S[q+H+6]=s.z,S[q+H+7]=0),_===!0&&(s.fromBufferAttribute(G,F),S[q+H+8]=s.x,S[q+H+9]=s.y,S[q+H+10]=s.z,S[q+H+11]=G.itemSize===4?s.w:1)}}d={count:u,texture:R,size:new Ie(w,A)},n.set(o,d),o.addEventListener("dispose",T)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)c.getUniforms().setValue(i,"morphTexture",a.morphTexture,t);else{let f=0;for(let _=0;_<l.length;_++)f+=l[_];let g=o.morphTargetsRelative?1:1-f;c.getUniforms().setValue(i,"morphTargetBaseInfluence",g),c.getUniforms().setValue(i,"morphTargetInfluences",l)}c.getUniforms().setValue(i,"morphTargetsTexture",d.texture,t),c.getUniforms().setValue(i,"morphTargetsTextureSize",d.size)}return{update:r}}function nv(i,e,t,n,s){let r=new WeakMap;function a(l){let h=s.render.frame,u=l.geometry,d=e.get(l,u);if(r.get(d)!==h&&(e.update(d),r.set(d,h)),l.isInstancedMesh&&(l.hasEventListener("dispose",c)===!1&&l.addEventListener("dispose",c),r.get(l)!==h&&(t.update(l.instanceMatrix,i.ARRAY_BUFFER),l.instanceColor!==null&&t.update(l.instanceColor,i.ARRAY_BUFFER),r.set(l,h))),l.isSkinnedMesh){let f=l.skeleton;r.get(f)!==h&&(f.update(),r.set(f,h))}return d}function o(){r=new WeakMap}function c(l){let h=l.target;h.removeEventListener("dispose",c),n.releaseStatesOfObject(h),t.remove(h.instanceMatrix),h.instanceColor!==null&&t.remove(h.instanceColor)}return{update:a,dispose:o}}function sv(i,e,t,n,s){let r=new dn(e,t,{type:i,depthBuffer:n,stencilBuffer:s,depthTexture:n?new fi(e,t):void 0}),a=new dn(e,t,{type:Qn,depthBuffer:!1,stencilBuffer:!1}),o=new Xt;o.setAttribute("position",new Ut([-1,3,0,-1,-1,0,3,-1,0],3)),o.setAttribute("uv",new Ut([0,2,0,0,2,0],2));let c=new Mo({uniforms:{tDiffuse:{value:null}},vertexShader:`
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
			}`,depthTest:!1,depthWrite:!1}),l=new It(o,c),h=new Nn(-1,1,1,-1,0,1),u=null,d=null,f=!1,g,_=null,m=[],p=!1;this.setSize=function(x,y){r.setSize(x,y),a.setSize(x,y);for(let w=0;w<m.length;w++){let A=m[w];A.setSize&&A.setSize(x,y)}},this.setEffects=function(x){m=x,p=m.length>0&&m[0].isRenderPass===!0;let y=r.width,w=r.height;for(let A=0;A<m.length;A++){let S=m[A];S.setSize&&S.setSize(y,w)}},this.begin=function(x,y){if(f||x.toneMapping===Un&&m.length===0)return!1;if(_=y,y!==null){let w=y.width,A=y.height;(r.width!==w||r.height!==A)&&this.setSize(w,A)}return p===!1&&x.setRenderTarget(r),g=x.toneMapping,x.toneMapping=Un,!0},this.hasRenderPass=function(){return p},this.end=function(x,y){x.toneMapping=g,f=!0;let w=r,A=a;for(let S=0;S<m.length;S++){let R=m[S];if(R.enabled!==!1&&(R.render(x,A,w,y),R.needsSwap!==!1)){let b=w;w=A,A=b}}if(u!==x.outputColorSpace||d!==x.toneMapping){u=x.outputColorSpace,d=x.toneMapping,c.defines={},ze.getTransfer(u)===$e&&(c.defines.SRGB_TRANSFER="");let S=iv[d];S&&(c.defines[S]=""),c.needsUpdate=!0}c.uniforms.tDiffuse.value=w.texture,x.setRenderTarget(_),x.render(l,h),_=null,f=!1},this.isCompositing=function(){return f},this.dispose=function(){r.depthTexture&&r.depthTexture.dispose(),r.dispose(),a.dispose(),o.dispose(),c.dispose()}}function fr(i,e,t){let n=i[0];if(n<=0||n>0)return i;let s=e*t,r=Wf[s];if(r===void 0&&(r=new Float32Array(s),Wf[s]=r),e!==0){n.toArray(r,0);for(let a=1,o=0;a!==e;++a)o+=t,i[a].toArray(r,o)}return r}function kt(i,e){if(i.length!==e.length)return!1;for(let t=0,n=i.length;t<n;t++)if(i[t]!==e[t])return!1;return!0}function Dt(i,e){for(let t=0,n=e.length;t<n;t++)i[t]=e[t]}function Ic(i,e){let t=qf[e];t===void 0&&(t=new Int32Array(e),qf[e]=t);for(let n=0;n!==e;++n)t[n]=i.allocateTextureUnit();return t}function rv(i,e){let t=this.cache;t[0]!==e&&(i.uniform1f(this.addr,e),t[0]=e)}function av(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(kt(t,e))return;i.uniform2fv(this.addr,e),Dt(t,e)}}function ov(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(i.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(kt(t,e))return;i.uniform3fv(this.addr,e),Dt(t,e)}}function cv(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(kt(t,e))return;i.uniform4fv(this.addr,e),Dt(t,e)}}function lv(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(kt(t,e))return;i.uniformMatrix2fv(this.addr,!1,e),Dt(t,e)}else{if(kt(t,n))return;Yf.set(n),i.uniformMatrix2fv(this.addr,!1,Yf),Dt(t,n)}}function hv(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(kt(t,e))return;i.uniformMatrix3fv(this.addr,!1,e),Dt(t,e)}else{if(kt(t,n))return;jf.set(n),i.uniformMatrix3fv(this.addr,!1,jf),Dt(t,n)}}function uv(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(kt(t,e))return;i.uniformMatrix4fv(this.addr,!1,e),Dt(t,e)}else{if(kt(t,n))return;Xf.set(n),i.uniformMatrix4fv(this.addr,!1,Xf),Dt(t,n)}}function dv(i,e){let t=this.cache;t[0]!==e&&(i.uniform1i(this.addr,e),t[0]=e)}function fv(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(kt(t,e))return;i.uniform2iv(this.addr,e),Dt(t,e)}}function pv(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(kt(t,e))return;i.uniform3iv(this.addr,e),Dt(t,e)}}function mv(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(kt(t,e))return;i.uniform4iv(this.addr,e),Dt(t,e)}}function gv(i,e){let t=this.cache;t[0]!==e&&(i.uniform1ui(this.addr,e),t[0]=e)}function _v(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(kt(t,e))return;i.uniform2uiv(this.addr,e),Dt(t,e)}}function bv(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(kt(t,e))return;i.uniform3uiv(this.addr,e),Dt(t,e)}}function xv(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(kt(t,e))return;i.uniform4uiv(this.addr,e),Dt(t,e)}}function vv(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s);let r;this.type===i.SAMPLER_2D_SHADOW?(zh.compareFunction=t.isReversedDepthBuffer()?Ec:Ac,r=zh):r=lp,t.setTexture2D(e||r,s)}function yv(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture3D(e||up,s)}function wv(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTextureCube(e||dp,s)}function Mv(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture2DArray(e||hp,s)}function Sv(i){switch(i){case 5126:return rv;case 35664:return av;case 35665:return ov;case 35666:return cv;case 35674:return lv;case 35675:return hv;case 35676:return uv;case 5124:case 35670:return dv;case 35667:case 35671:return fv;case 35668:case 35672:return pv;case 35669:case 35673:return mv;case 5125:return gv;case 36294:return _v;case 36295:return bv;case 36296:return xv;case 35678:case 36198:case 36298:case 36306:case 35682:return vv;case 35679:case 36299:case 36307:return yv;case 35680:case 36300:case 36308:case 36293:return wv;case 36289:case 36303:case 36311:case 36292:return Mv}}function Av(i,e){i.uniform1fv(this.addr,e)}function Ev(i,e){let t=fr(e,this.size,2);i.uniform2fv(this.addr,t)}function Tv(i,e){let t=fr(e,this.size,3);i.uniform3fv(this.addr,t)}function Rv(i,e){let t=fr(e,this.size,4);i.uniform4fv(this.addr,t)}function Cv(i,e){let t=fr(e,this.size,4);i.uniformMatrix2fv(this.addr,!1,t)}function Lv(i,e){let t=fr(e,this.size,9);i.uniformMatrix3fv(this.addr,!1,t)}function Pv(i,e){let t=fr(e,this.size,16);i.uniformMatrix4fv(this.addr,!1,t)}function Iv(i,e){i.uniform1iv(this.addr,e)}function kv(i,e){i.uniform2iv(this.addr,e)}function Dv(i,e){i.uniform3iv(this.addr,e)}function Fv(i,e){i.uniform4iv(this.addr,e)}function Nv(i,e){i.uniform1uiv(this.addr,e)}function Uv(i,e){i.uniform2uiv(this.addr,e)}function Ov(i,e){i.uniform3uiv(this.addr,e)}function Bv(i,e){i.uniform4uiv(this.addr,e)}function Hv(i,e,t){let n=this.cache,s=e.length,r=Ic(t,s);kt(n,r)||(i.uniform1iv(this.addr,r),Dt(n,r));let a;this.type===i.SAMPLER_2D_SHADOW?a=zh:a=lp;for(let o=0;o!==s;++o)t.setTexture2D(e[o]||a,r[o])}function zv(i,e,t){let n=this.cache,s=e.length,r=Ic(t,s);kt(n,r)||(i.uniform1iv(this.addr,r),Dt(n,r));for(let a=0;a!==s;++a)t.setTexture3D(e[a]||up,r[a])}function Vv(i,e,t){let n=this.cache,s=e.length,r=Ic(t,s);kt(n,r)||(i.uniform1iv(this.addr,r),Dt(n,r));for(let a=0;a!==s;++a)t.setTextureCube(e[a]||dp,r[a])}function Gv(i,e,t){let n=this.cache,s=e.length,r=Ic(t,s);kt(n,r)||(i.uniform1iv(this.addr,r),Dt(n,r));for(let a=0;a!==s;++a)t.setTexture2DArray(e[a]||hp,r[a])}function Wv(i){switch(i){case 5126:return Av;case 35664:return Ev;case 35665:return Tv;case 35666:return Rv;case 35674:return Cv;case 35675:return Lv;case 35676:return Pv;case 5124:case 35670:return Iv;case 35667:case 35671:return kv;case 35668:case 35672:return Dv;case 35669:case 35673:return Fv;case 5125:return Nv;case 36294:return Uv;case 36295:return Ov;case 36296:return Bv;case 35678:case 36198:case 36298:case 36306:case 35682:return Hv;case 35679:case 36299:case 36307:return zv;case 35680:case 36300:case 36308:case 36293:return Vv;case 36289:case 36303:case 36311:case 36292:return Gv}}function Kf(i,e){i.seq.push(e),i.map[e.id]=e}function qv(i,e,t){let n=i.name,s=n.length;for(Bh.lastIndex=0;;){let r=Bh.exec(n),a=Bh.lastIndex,o=r[1],c=r[2]==="]",l=r[3];if(c&&(o=o|0),l===void 0||l==="["&&a+2===s){Kf(t,l===void 0?new Vh(o,i,e):new Gh(o,i,e));break}else{let u=t.map[o];u===void 0&&(u=new Wh(o),Kf(t,u)),t=u}}}function Jf(i,e,t){let n=i.createShader(e);return i.shaderSource(n,t),i.compileShader(n),n}function Yv(i,e){let t=i.split(`
`),n=[],s=Math.max(e-6,0),r=Math.min(e+6,t.length);for(let a=s;a<r;a++){let o=a+1;n.push(`${o===e?">":" "} ${o}: ${t[a]}`)}return n.join(`
`)}function Kv(i){ze._getMatrix($f,ze.workingColorSpace,i);let e=`mat3( ${$f.elements.map(t=>t.toFixed(4))} )`;switch(ze.getTransfer(i)){case Fr:return[e,"LinearTransferOETF"];case $e:return[e,"sRGBTransferOETF"];default:return ye("WebGLProgram: Unsupported color space: ",i),[e,"LinearTransferOETF"]}}function Zf(i,e,t){let n=i.getShaderParameter(e,i.COMPILE_STATUS),r=(i.getShaderInfoLog(e)||"").trim();if(n&&r==="")return"";let a=/ERROR: 0:(\d+)/.exec(r);if(a){let o=parseInt(a[1]);return t.toUpperCase()+`

`+r+`

`+Yv(i.getShaderSource(e),o)}else return r}function Jv(i,e){let t=Kv(e);return[`vec4 ${i}( vec4 value ) {`,`	return ${t[1]}( vec4( value.rgb * ${t[0]}, value.a ) );`,"}"].join(`
`)}function Zv(i,e){let t=$v[e];return t===void 0?(ye("WebGLProgram: Unsupported toneMapping:",e),"vec3 "+i+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+i+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}function Qv(){ze.getLuminanceCoefficients(Rc);let i=Rc.x.toFixed(4),e=Rc.y.toFixed(4),t=Rc.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${i}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function ey(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",i.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(ga).join(`
`)}function ty(i){let e=[];for(let t in i){let n=i[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function ny(i,e){let t={},n=i.getProgramParameter(e,i.ACTIVE_ATTRIBUTES);for(let s=0;s<n;s++){let r=i.getActiveAttrib(e,s),a=r.name,o=1;r.type===i.FLOAT_MAT2&&(o=2),r.type===i.FLOAT_MAT3&&(o=3),r.type===i.FLOAT_MAT4&&(o=4),t[a]={type:r.type,location:i.getAttribLocation(e,a),locationSize:o}}return t}function ga(i){return i!==""}function Qf(i,e){let t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return i.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function ep(i,e){return i.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}function qh(i){return i.replace(iy,ry)}function ry(i,e){let t=Be[e];if(t===void 0){let n=sy.get(e);if(n!==void 0)t=Be[n],ye('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,n);else throw new Error("Can not resolve #include <"+e+">")}return qh(t)}function tp(i){return i.replace(ay,oy)}function oy(i,e,t,n){let s="";for(let r=parseInt(e);r<parseInt(t);r++)s+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return s}function np(i){let e=`precision ${i.precision} float;
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
#define LOW_PRECISION`),e}function ly(i){return cy[i.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}function uy(i){return i.envMap===!1?"ENVMAP_TYPE_CUBE":hy[i.envMapMode]||"ENVMAP_TYPE_CUBE"}function fy(i){return i.envMap===!1?"ENVMAP_MODE_REFLECTION":dy[i.envMapMode]||"ENVMAP_MODE_REFLECTION"}function my(i){return i.envMap===!1?"ENVMAP_BLENDING_NONE":py[i.combine]||"ENVMAP_BLENDING_NONE"}function gy(i){let e=i.envMapCubeUVHeight;if(e===null)return null;let t=Math.log2(e)-2,n=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),112)),texelHeight:n,maxMip:t}}function _y(i,e,t,n){let s=i.getContext(),r=t.defines,a=t.vertexShader,o=t.fragmentShader,c=ly(t),l=uy(t),h=fy(t),u=my(t),d=gy(t),f=ey(t),g=ty(r),_=s.createProgram(),m,p,x=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(m=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g].filter(ga).join(`
`),m.length>0&&(m+=`
`),p=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g].filter(ga).join(`
`),p.length>0&&(p+=`
`)):(m=[np(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+h:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexNormals?"#define HAS_NORMAL":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+c:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(ga).join(`
`),p=[np(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+l:"",t.envMap?"#define "+h:"",t.envMap?"#define "+u:"",d?"#define CUBEUV_TEXEL_WIDTH "+d.texelWidth:"",d?"#define CUBEUV_TEXEL_HEIGHT "+d.texelHeight:"",d?"#define CUBEUV_MAX_MIP "+d.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor?"#define USE_COLOR":"",t.vertexAlphas||t.batchingColor?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+c:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==Un?"#define TONE_MAPPING":"",t.toneMapping!==Un?Be.tonemapping_pars_fragment:"",t.toneMapping!==Un?Zv("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",Be.colorspace_pars_fragment,Jv("linearToOutputTexel",t.outputColorSpace),Qv(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(ga).join(`
`)),a=qh(a),a=Qf(a,t),a=ep(a,t),o=qh(o),o=Qf(o,t),o=ep(o,t),a=tp(a),o=tp(o),t.isRawShaderMaterial!==!0&&(x=`#version 300 es
`,m=[f,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+m,p=["#define varying in",t.glslVersion===wh?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===wh?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+p);let y=x+m+a,w=x+p+o,A=Jf(s,s.VERTEX_SHADER,y),S=Jf(s,s.FRAGMENT_SHADER,w);s.attachShader(_,A),s.attachShader(_,S),t.index0AttributeName!==void 0?s.bindAttribLocation(_,0,t.index0AttributeName):t.morphTargets===!0&&s.bindAttribLocation(_,0,"position"),s.linkProgram(_);function R(C){if(i.debug.checkShaderErrors){let N=s.getProgramInfoLog(_)||"",G=s.getShaderInfoLog(A)||"",q=s.getShaderInfoLog(S)||"",F=N.trim(),H=G.trim(),V=q.trim(),Z=!0,Q=!0;if(s.getProgramParameter(_,s.LINK_STATUS)===!1)if(Z=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(s,_,A,S);else{let le=Zf(s,A,"vertex"),xe=Zf(s,S,"fragment");Te("THREE.WebGLProgram: Shader Error "+s.getError()+" - VALIDATE_STATUS "+s.getProgramParameter(_,s.VALIDATE_STATUS)+`

Material Name: `+C.name+`
Material Type: `+C.type+`

Program Info Log: `+F+`
`+le+`
`+xe)}else F!==""?ye("WebGLProgram: Program Info Log:",F):(H===""||V==="")&&(Q=!1);Q&&(C.diagnostics={runnable:Z,programLog:F,vertexShader:{log:H,prefix:m},fragmentShader:{log:V,prefix:p}})}s.deleteShader(A),s.deleteShader(S),b=new dr(s,_),T=ny(s,_)}let b;this.getUniforms=function(){return b===void 0&&R(this),b};let T;this.getAttributes=function(){return T===void 0&&R(this),T};let P=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return P===!1&&(P=s.getProgramParameter(_,Xv)),P},this.destroy=function(){n.releaseStatesOfProgram(this),s.deleteProgram(_),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=jv++,this.cacheKey=e,this.usedTimes=1,this.program=_,this.vertexShader=A,this.fragmentShader=S,this}function xy(i){return i===Hi||i===ha||i===ua}function vy(i,e,t,n,s,r){let a=new Or,o=new Xh,c=new Set,l=[],h=new Map,u=n.logarithmicDepthBuffer,d=n.precision,f={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function g(b){return c.add(b),b===0?"uv":`uv${b}`}function _(b,T,P,C,N,G){let q=C.fog,F=N.geometry,H=b.isMeshStandardMaterial||b.isMeshLambertMaterial||b.isMeshPhongMaterial?C.environment:null,V=b.isMeshStandardMaterial||b.isMeshLambertMaterial&&!b.envMap||b.isMeshPhongMaterial&&!b.envMap,Z=e.get(b.envMap||H,V),Q=Z&&Z.mapping===ra?Z.image.height:null,le=f[b.type];b.precision!==null&&(d=n.getMaxPrecision(b.precision),d!==b.precision&&ye("WebGLProgram.getParameters:",b.precision,"not supported, using",d,"instead."));let xe=F.morphAttributes.position||F.morphAttributes.normal||F.morphAttributes.color,Se=xe!==void 0?xe.length:0,Ye=0;F.morphAttributes.position!==void 0&&(Ye=1),F.morphAttributes.normal!==void 0&&(Ye=2),F.morphAttributes.color!==void 0&&(Ye=3);let Qe,Ue,K,de;if(le){let Fe=ti[le];Qe=Fe.vertexShader,Ue=Fe.fragmentShader}else Qe=b.vertexShader,Ue=b.fragmentShader,o.update(b),K=o.getVertexShaderID(b),de=o.getFragmentShaderID(b);let ie=i.getRenderTarget(),Re=i.state.buffers.depth.getReversed(),De=N.isInstancedMesh===!0,Ce=N.isBatchedMesh===!0,ft=!!b.map,Xe=!!b.matcap,et=!!Z,dt=!!b.aoMap,Ge=!!b.lightMap,Ct=!!b.bumpMap,pt=!!b.normalMap,cn=!!b.displacementMap,k=!!b.emissiveMap,Lt=!!b.metalnessMap,je=!!b.roughnessMap,ht=b.anisotropy>0,oe=b.clearcoat>0,mt=b.dispersion>0,E=b.iridescence>0,v=b.sheen>0,U=b.transmission>0,j=ht&&!!b.anisotropyMap,$=oe&&!!b.clearcoatMap,ee=oe&&!!b.clearcoatNormalMap,ae=oe&&!!b.clearcoatRoughnessMap,W=E&&!!b.iridescenceMap,Y=E&&!!b.iridescenceThicknessMap,fe=v&&!!b.sheenColorMap,_e=v&&!!b.sheenRoughnessMap,se=!!b.specularMap,te=!!b.specularColorMap,Pe=!!b.specularIntensityMap,Oe=U&&!!b.transmissionMap,Je=U&&!!b.thicknessMap,I=!!b.gradientMap,ne=!!b.alphaMap,X=b.alphaTest>0,pe=!!b.alphaHash,re=!!b.extensions,J=Un;b.toneMapped&&(ie===null||ie.isXRRenderTarget===!0)&&(J=i.toneMapping);let we={shaderID:le,shaderType:b.type,shaderName:b.name,vertexShader:Qe,fragmentShader:Ue,defines:b.defines,customVertexShaderID:K,customFragmentShaderID:de,isRawShaderMaterial:b.isRawShaderMaterial===!0,glslVersion:b.glslVersion,precision:d,batching:Ce,batchingColor:Ce&&N._colorsTexture!==null,instancing:De,instancingColor:De&&N.instanceColor!==null,instancingMorph:De&&N.morphTexture!==null,outputColorSpace:ie===null?i.outputColorSpace:ie.isXRRenderTarget===!0?ie.texture.colorSpace:ze.workingColorSpace,alphaToCoverage:!!b.alphaToCoverage,map:ft,matcap:Xe,envMap:et,envMapMode:et&&Z.mapping,envMapCubeUVHeight:Q,aoMap:dt,lightMap:Ge,bumpMap:Ct,normalMap:pt,displacementMap:cn,emissiveMap:k,normalMapObjectSpace:pt&&b.normalMapType===Mf,normalMapTangentSpace:pt&&b.normalMapType===Sc,packedNormalMap:pt&&b.normalMapType===Sc&&xy(b.normalMap.format),metalnessMap:Lt,roughnessMap:je,anisotropy:ht,anisotropyMap:j,clearcoat:oe,clearcoatMap:$,clearcoatNormalMap:ee,clearcoatRoughnessMap:ae,dispersion:mt,iridescence:E,iridescenceMap:W,iridescenceThicknessMap:Y,sheen:v,sheenColorMap:fe,sheenRoughnessMap:_e,specularMap:se,specularColorMap:te,specularIntensityMap:Pe,transmission:U,transmissionMap:Oe,thicknessMap:Je,gradientMap:I,opaque:b.transparent===!1&&b.blending===ts&&b.alphaToCoverage===!1,alphaMap:ne,alphaTest:X,alphaHash:pe,combine:b.combine,mapUv:ft&&g(b.map.channel),aoMapUv:dt&&g(b.aoMap.channel),lightMapUv:Ge&&g(b.lightMap.channel),bumpMapUv:Ct&&g(b.bumpMap.channel),normalMapUv:pt&&g(b.normalMap.channel),displacementMapUv:cn&&g(b.displacementMap.channel),emissiveMapUv:k&&g(b.emissiveMap.channel),metalnessMapUv:Lt&&g(b.metalnessMap.channel),roughnessMapUv:je&&g(b.roughnessMap.channel),anisotropyMapUv:j&&g(b.anisotropyMap.channel),clearcoatMapUv:$&&g(b.clearcoatMap.channel),clearcoatNormalMapUv:ee&&g(b.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:ae&&g(b.clearcoatRoughnessMap.channel),iridescenceMapUv:W&&g(b.iridescenceMap.channel),iridescenceThicknessMapUv:Y&&g(b.iridescenceThicknessMap.channel),sheenColorMapUv:fe&&g(b.sheenColorMap.channel),sheenRoughnessMapUv:_e&&g(b.sheenRoughnessMap.channel),specularMapUv:se&&g(b.specularMap.channel),specularColorMapUv:te&&g(b.specularColorMap.channel),specularIntensityMapUv:Pe&&g(b.specularIntensityMap.channel),transmissionMapUv:Oe&&g(b.transmissionMap.channel),thicknessMapUv:Je&&g(b.thicknessMap.channel),alphaMapUv:ne&&g(b.alphaMap.channel),vertexTangents:!!F.attributes.tangent&&(pt||ht),vertexNormals:!!F.attributes.normal,vertexColors:b.vertexColors,vertexAlphas:b.vertexColors===!0&&!!F.attributes.color&&F.attributes.color.itemSize===4,pointsUvs:N.isPoints===!0&&!!F.attributes.uv&&(ft||ne),fog:!!q,useFog:b.fog===!0,fogExp2:!!q&&q.isFogExp2,flatShading:b.wireframe===!1&&(b.flatShading===!0||F.attributes.normal===void 0&&pt===!1&&(b.isMeshLambertMaterial||b.isMeshPhongMaterial||b.isMeshStandardMaterial||b.isMeshPhysicalMaterial)),sizeAttenuation:b.sizeAttenuation===!0,logarithmicDepthBuffer:u,reversedDepthBuffer:Re,skinning:N.isSkinnedMesh===!0,morphTargets:F.morphAttributes.position!==void 0,morphNormals:F.morphAttributes.normal!==void 0,morphColors:F.morphAttributes.color!==void 0,morphTargetsCount:Se,morphTextureStride:Ye,numDirLights:T.directional.length,numPointLights:T.point.length,numSpotLights:T.spot.length,numSpotLightMaps:T.spotLightMap.length,numRectAreaLights:T.rectArea.length,numHemiLights:T.hemi.length,numDirLightShadows:T.directionalShadowMap.length,numPointLightShadows:T.pointShadowMap.length,numSpotLightShadows:T.spotShadowMap.length,numSpotLightShadowsWithMaps:T.numSpotLightShadowsWithMaps,numLightProbes:T.numLightProbes,numLightProbeGrids:G.length,numClippingPlanes:r.numPlanes,numClipIntersection:r.numIntersection,dithering:b.dithering,shadowMapEnabled:i.shadowMap.enabled&&P.length>0,shadowMapType:i.shadowMap.type,toneMapping:J,decodeVideoTexture:ft&&b.map.isVideoTexture===!0&&ze.getTransfer(b.map.colorSpace)===$e,decodeVideoTextureEmissive:k&&b.emissiveMap.isVideoTexture===!0&&ze.getTransfer(b.emissiveMap.colorSpace)===$e,premultipliedAlpha:b.premultipliedAlpha,doubleSided:b.side===rn,flipSided:b.side===Zt,useDepthPacking:b.depthPacking>=0,depthPacking:b.depthPacking||0,index0AttributeName:b.index0AttributeName,extensionClipCullDistance:re&&b.extensions.clipCullDistance===!0&&t.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(re&&b.extensions.multiDraw===!0||Ce)&&t.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:t.has("KHR_parallel_shader_compile"),customProgramCacheKey:b.customProgramCacheKey()};return we.vertexUv1s=c.has(1),we.vertexUv2s=c.has(2),we.vertexUv3s=c.has(3),c.clear(),we}function m(b){let T=[];if(b.shaderID?T.push(b.shaderID):(T.push(b.customVertexShaderID),T.push(b.customFragmentShaderID)),b.defines!==void 0)for(let P in b.defines)T.push(P),T.push(b.defines[P]);return b.isRawShaderMaterial===!1&&(p(T,b),x(T,b),T.push(i.outputColorSpace)),T.push(b.customProgramCacheKey),T.join()}function p(b,T){b.push(T.precision),b.push(T.outputColorSpace),b.push(T.envMapMode),b.push(T.envMapCubeUVHeight),b.push(T.mapUv),b.push(T.alphaMapUv),b.push(T.lightMapUv),b.push(T.aoMapUv),b.push(T.bumpMapUv),b.push(T.normalMapUv),b.push(T.displacementMapUv),b.push(T.emissiveMapUv),b.push(T.metalnessMapUv),b.push(T.roughnessMapUv),b.push(T.anisotropyMapUv),b.push(T.clearcoatMapUv),b.push(T.clearcoatNormalMapUv),b.push(T.clearcoatRoughnessMapUv),b.push(T.iridescenceMapUv),b.push(T.iridescenceThicknessMapUv),b.push(T.sheenColorMapUv),b.push(T.sheenRoughnessMapUv),b.push(T.specularMapUv),b.push(T.specularColorMapUv),b.push(T.specularIntensityMapUv),b.push(T.transmissionMapUv),b.push(T.thicknessMapUv),b.push(T.combine),b.push(T.fogExp2),b.push(T.sizeAttenuation),b.push(T.morphTargetsCount),b.push(T.morphAttributeCount),b.push(T.numDirLights),b.push(T.numPointLights),b.push(T.numSpotLights),b.push(T.numSpotLightMaps),b.push(T.numHemiLights),b.push(T.numRectAreaLights),b.push(T.numDirLightShadows),b.push(T.numPointLightShadows),b.push(T.numSpotLightShadows),b.push(T.numSpotLightShadowsWithMaps),b.push(T.numLightProbes),b.push(T.shadowMapType),b.push(T.toneMapping),b.push(T.numClippingPlanes),b.push(T.numClipIntersection),b.push(T.depthPacking)}function x(b,T){a.disableAll(),T.instancing&&a.enable(0),T.instancingColor&&a.enable(1),T.instancingMorph&&a.enable(2),T.matcap&&a.enable(3),T.envMap&&a.enable(4),T.normalMapObjectSpace&&a.enable(5),T.normalMapTangentSpace&&a.enable(6),T.clearcoat&&a.enable(7),T.iridescence&&a.enable(8),T.alphaTest&&a.enable(9),T.vertexColors&&a.enable(10),T.vertexAlphas&&a.enable(11),T.vertexUv1s&&a.enable(12),T.vertexUv2s&&a.enable(13),T.vertexUv3s&&a.enable(14),T.vertexTangents&&a.enable(15),T.anisotropy&&a.enable(16),T.alphaHash&&a.enable(17),T.batching&&a.enable(18),T.dispersion&&a.enable(19),T.batchingColor&&a.enable(20),T.gradientMap&&a.enable(21),T.packedNormalMap&&a.enable(22),T.vertexNormals&&a.enable(23),b.push(a.mask),a.disableAll(),T.fog&&a.enable(0),T.useFog&&a.enable(1),T.flatShading&&a.enable(2),T.logarithmicDepthBuffer&&a.enable(3),T.reversedDepthBuffer&&a.enable(4),T.skinning&&a.enable(5),T.morphTargets&&a.enable(6),T.morphNormals&&a.enable(7),T.morphColors&&a.enable(8),T.premultipliedAlpha&&a.enable(9),T.shadowMapEnabled&&a.enable(10),T.doubleSided&&a.enable(11),T.flipSided&&a.enable(12),T.useDepthPacking&&a.enable(13),T.dithering&&a.enable(14),T.transmission&&a.enable(15),T.sheen&&a.enable(16),T.opaque&&a.enable(17),T.pointsUvs&&a.enable(18),T.decodeVideoTexture&&a.enable(19),T.decodeVideoTextureEmissive&&a.enable(20),T.alphaToCoverage&&a.enable(21),T.numLightProbeGrids>0&&a.enable(22),b.push(a.mask)}function y(b){let T=f[b.type],P;if(T){let C=ti[T];P=Nf.clone(C.uniforms)}else P=b.uniforms;return P}function w(b,T){let P=h.get(T);return P!==void 0?++P.usedTimes:(P=new _y(i,T,b,s),l.push(P),h.set(T,P)),P}function A(b){if(--b.usedTimes===0){let T=l.indexOf(b);l[T]=l[l.length-1],l.pop(),h.delete(b.cacheKey),b.destroy()}}function S(b){o.remove(b)}function R(){o.dispose()}return{getParameters:_,getProgramCacheKey:m,getUniforms:y,acquireProgram:w,releaseProgram:A,releaseShaderCache:S,programs:l,dispose:R}}function yy(){let i=new WeakMap;function e(a){return i.has(a)}function t(a){let o=i.get(a);return o===void 0&&(o={},i.set(a,o)),o}function n(a){i.delete(a)}function s(a,o,c){i.get(a)[o]=c}function r(){i=new WeakMap}return{has:e,get:t,remove:n,update:s,dispose:r}}function wy(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.material.id!==e.material.id?i.material.id-e.material.id:i.materialVariant!==e.materialVariant?i.materialVariant-e.materialVariant:i.z!==e.z?i.z-e.z:i.id-e.id}function ip(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.z!==e.z?e.z-i.z:i.id-e.id}function sp(){let i=[],e=0,t=[],n=[],s=[];function r(){e=0,t.length=0,n.length=0,s.length=0}function a(d){let f=0;return d.isInstancedMesh&&(f+=2),d.isSkinnedMesh&&(f+=1),f}function o(d,f,g,_,m,p){let x=i[e];return x===void 0?(x={id:d.id,object:d,geometry:f,material:g,materialVariant:a(d),groupOrder:_,renderOrder:d.renderOrder,z:m,group:p},i[e]=x):(x.id=d.id,x.object=d,x.geometry=f,x.material=g,x.materialVariant=a(d),x.groupOrder=_,x.renderOrder=d.renderOrder,x.z=m,x.group=p),e++,x}function c(d,f,g,_,m,p){let x=o(d,f,g,_,m,p);g.transmission>0?n.push(x):g.transparent===!0?s.push(x):t.push(x)}function l(d,f,g,_,m,p){let x=o(d,f,g,_,m,p);g.transmission>0?n.unshift(x):g.transparent===!0?s.unshift(x):t.unshift(x)}function h(d,f){t.length>1&&t.sort(d||wy),n.length>1&&n.sort(f||ip),s.length>1&&s.sort(f||ip)}function u(){for(let d=e,f=i.length;d<f;d++){let g=i[d];if(g.id===null)break;g.id=null,g.object=null,g.geometry=null,g.material=null,g.group=null}}return{opaque:t,transmissive:n,transparent:s,init:r,push:c,unshift:l,finish:u,sort:h}}function My(){let i=new WeakMap;function e(n,s){let r=i.get(n),a;return r===void 0?(a=new sp,i.set(n,[a])):s>=r.length?(a=new sp,r.push(a)):a=r[s],a}function t(){i=new WeakMap}return{get:e,dispose:t}}function Sy(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new L,color:new Ee};break;case"SpotLight":t={position:new L,direction:new L,color:new Ee,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new L,color:new Ee,distance:0,decay:0};break;case"HemisphereLight":t={direction:new L,skyColor:new Ee,groundColor:new Ee};break;case"RectAreaLight":t={color:new Ee,position:new L,halfWidth:new L,halfHeight:new L};break}return i[e.id]=t,t}}}function Ay(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ie};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ie};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ie,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[e.id]=t,t}}}function Ty(i,e){return(e.castShadow?2:0)-(i.castShadow?2:0)+(e.map?1:0)-(i.map?1:0)}function Ry(i){let e=new Sy,t=Ay(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let l=0;l<9;l++)n.probe.push(new L);let s=new L,r=new Le,a=new Le;function o(l){let h=0,u=0,d=0;for(let T=0;T<9;T++)n.probe[T].set(0,0,0);let f=0,g=0,_=0,m=0,p=0,x=0,y=0,w=0,A=0,S=0,R=0;l.sort(Ty);for(let T=0,P=l.length;T<P;T++){let C=l[T],N=C.color,G=C.intensity,q=C.distance,F=null;if(C.shadow&&C.shadow.map&&(C.shadow.map.texture.format===Hi?F=C.shadow.map.texture:F=C.shadow.map.depthTexture||C.shadow.map.texture),C.isAmbientLight)h+=N.r*G,u+=N.g*G,d+=N.b*G;else if(C.isLightProbe){for(let H=0;H<9;H++)n.probe[H].addScaledVector(C.sh.coefficients[H],G);R++}else if(C.isDirectionalLight){let H=e.get(C);if(H.color.copy(C.color).multiplyScalar(C.intensity),C.castShadow){let V=C.shadow,Z=t.get(C);Z.shadowIntensity=V.intensity,Z.shadowBias=V.bias,Z.shadowNormalBias=V.normalBias,Z.shadowRadius=V.radius,Z.shadowMapSize=V.mapSize,n.directionalShadow[f]=Z,n.directionalShadowMap[f]=F,n.directionalShadowMatrix[f]=C.shadow.matrix,x++}n.directional[f]=H,f++}else if(C.isSpotLight){let H=e.get(C);H.position.setFromMatrixPosition(C.matrixWorld),H.color.copy(N).multiplyScalar(G),H.distance=q,H.coneCos=Math.cos(C.angle),H.penumbraCos=Math.cos(C.angle*(1-C.penumbra)),H.decay=C.decay,n.spot[_]=H;let V=C.shadow;if(C.map&&(n.spotLightMap[A]=C.map,A++,V.updateMatrices(C),C.castShadow&&S++),n.spotLightMatrix[_]=V.matrix,C.castShadow){let Z=t.get(C);Z.shadowIntensity=V.intensity,Z.shadowBias=V.bias,Z.shadowNormalBias=V.normalBias,Z.shadowRadius=V.radius,Z.shadowMapSize=V.mapSize,n.spotShadow[_]=Z,n.spotShadowMap[_]=F,w++}_++}else if(C.isRectAreaLight){let H=e.get(C);H.color.copy(N).multiplyScalar(G),H.halfWidth.set(C.width*.5,0,0),H.halfHeight.set(0,C.height*.5,0),n.rectArea[m]=H,m++}else if(C.isPointLight){let H=e.get(C);if(H.color.copy(C.color).multiplyScalar(C.intensity),H.distance=C.distance,H.decay=C.decay,C.castShadow){let V=C.shadow,Z=t.get(C);Z.shadowIntensity=V.intensity,Z.shadowBias=V.bias,Z.shadowNormalBias=V.normalBias,Z.shadowRadius=V.radius,Z.shadowMapSize=V.mapSize,Z.shadowCameraNear=V.camera.near,Z.shadowCameraFar=V.camera.far,n.pointShadow[g]=Z,n.pointShadowMap[g]=F,n.pointShadowMatrix[g]=C.shadow.matrix,y++}n.point[g]=H,g++}else if(C.isHemisphereLight){let H=e.get(C);H.skyColor.copy(C.color).multiplyScalar(G),H.groundColor.copy(C.groundColor).multiplyScalar(G),n.hemi[p]=H,p++}}m>0&&(i.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=ce.LTC_FLOAT_1,n.rectAreaLTC2=ce.LTC_FLOAT_2):(n.rectAreaLTC1=ce.LTC_HALF_1,n.rectAreaLTC2=ce.LTC_HALF_2)),n.ambient[0]=h,n.ambient[1]=u,n.ambient[2]=d;let b=n.hash;(b.directionalLength!==f||b.pointLength!==g||b.spotLength!==_||b.rectAreaLength!==m||b.hemiLength!==p||b.numDirectionalShadows!==x||b.numPointShadows!==y||b.numSpotShadows!==w||b.numSpotMaps!==A||b.numLightProbes!==R)&&(n.directional.length=f,n.spot.length=_,n.rectArea.length=m,n.point.length=g,n.hemi.length=p,n.directionalShadow.length=x,n.directionalShadowMap.length=x,n.pointShadow.length=y,n.pointShadowMap.length=y,n.spotShadow.length=w,n.spotShadowMap.length=w,n.directionalShadowMatrix.length=x,n.pointShadowMatrix.length=y,n.spotLightMatrix.length=w+A-S,n.spotLightMap.length=A,n.numSpotLightShadowsWithMaps=S,n.numLightProbes=R,b.directionalLength=f,b.pointLength=g,b.spotLength=_,b.rectAreaLength=m,b.hemiLength=p,b.numDirectionalShadows=x,b.numPointShadows=y,b.numSpotShadows=w,b.numSpotMaps=A,b.numLightProbes=R,n.version=Ey++)}function c(l,h){let u=0,d=0,f=0,g=0,_=0,m=h.matrixWorldInverse;for(let p=0,x=l.length;p<x;p++){let y=l[p];if(y.isDirectionalLight){let w=n.directional[u];w.direction.setFromMatrixPosition(y.matrixWorld),s.setFromMatrixPosition(y.target.matrixWorld),w.direction.sub(s),w.direction.transformDirection(m),u++}else if(y.isSpotLight){let w=n.spot[f];w.position.setFromMatrixPosition(y.matrixWorld),w.position.applyMatrix4(m),w.direction.setFromMatrixPosition(y.matrixWorld),s.setFromMatrixPosition(y.target.matrixWorld),w.direction.sub(s),w.direction.transformDirection(m),f++}else if(y.isRectAreaLight){let w=n.rectArea[g];w.position.setFromMatrixPosition(y.matrixWorld),w.position.applyMatrix4(m),a.identity(),r.copy(y.matrixWorld),r.premultiply(m),a.extractRotation(r),w.halfWidth.set(y.width*.5,0,0),w.halfHeight.set(0,y.height*.5,0),w.halfWidth.applyMatrix4(a),w.halfHeight.applyMatrix4(a),g++}else if(y.isPointLight){let w=n.point[d];w.position.setFromMatrixPosition(y.matrixWorld),w.position.applyMatrix4(m),d++}else if(y.isHemisphereLight){let w=n.hemi[_];w.direction.setFromMatrixPosition(y.matrixWorld),w.direction.transformDirection(m),_++}}}return{setup:o,setupView:c,state:n}}function rp(i){let e=new Ry(i),t=[],n=[],s=[];function r(d){u.camera=d,t.length=0,n.length=0,s.length=0}function a(d){t.push(d)}function o(d){n.push(d)}function c(d){s.push(d)}function l(){e.setup(t)}function h(d){e.setupView(t,d)}let u={lightsArray:t,shadowsArray:n,lightProbeGridArray:s,camera:null,lights:e,transmissionRenderTarget:{},textureUnits:0};return{init:r,state:u,setupLights:l,setupLightsView:h,pushLight:a,pushShadow:o,pushLightProbeGrid:c}}function Cy(i){let e=new WeakMap;function t(s,r=0){let a=e.get(s),o;return a===void 0?(o=new rp(i),e.set(s,[o])):r>=a.length?(o=new rp(i),a.push(o)):o=a[r],o}function n(){e=new WeakMap}return{get:t,dispose:n}}function Dy(i,e,t){let n=new er,s=new Ie,r=new Ie,a=new st,o=new So,c=new Ao,l={},h=t.maxTextureSize,u={[Dn]:Zt,[Zt]:Dn,[rn]:rn},d=new pn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Ie},radius:{value:4}},vertexShader:Ly,fragmentShader:Py}),f=d.clone();f.defines.HORIZONTAL_PASS=1;let g=new Xt;g.setAttribute("position",new Et(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let _=new It(g,d),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=sa;let p=this.type;this.render=function(S,R,b){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||S.length===0)return;this.type===Zd&&(ye("WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."),this.type=sa);let T=i.getRenderTarget(),P=i.getActiveCubeFace(),C=i.getActiveMipmapLevel(),N=i.state;N.setBlending(Zn),N.buffers.depth.getReversed()===!0?N.buffers.color.setClear(0,0,0,0):N.buffers.color.setClear(1,1,1,1),N.buffers.depth.setTest(!0),N.setScissorTest(!1);let G=p!==this.type;G&&R.traverse(function(q){q.material&&(Array.isArray(q.material)?q.material.forEach(F=>F.needsUpdate=!0):q.material.needsUpdate=!0)});for(let q=0,F=S.length;q<F;q++){let H=S[q],V=H.shadow;if(V===void 0){ye("WebGLShadowMap:",H,"has no shadow.");continue}if(V.autoUpdate===!1&&V.needsUpdate===!1)continue;s.copy(V.mapSize);let Z=V.getFrameExtents();s.multiply(Z),r.copy(V.mapSize),(s.x>h||s.y>h)&&(s.x>h&&(r.x=Math.floor(h/Z.x),s.x=r.x*Z.x,V.mapSize.x=r.x),s.y>h&&(r.y=Math.floor(h/Z.y),s.y=r.y*Z.y,V.mapSize.y=r.y));let Q=i.state.buffers.depth.getReversed();if(V.camera._reversedDepth=Q,V.map===null||G===!0){if(V.map!==null&&(V.map.depthTexture!==null&&(V.map.depthTexture.dispose(),V.map.depthTexture=null),V.map.dispose()),this.type===ar){if(H.isPointLight){ye("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}V.map=new dn(s.x,s.y,{format:Hi,type:Qn,minFilter:wt,magFilter:wt,generateMipmaps:!1}),V.map.texture.name=H.name+".shadowMap",V.map.depthTexture=new fi(s.x,s.y,mn),V.map.depthTexture.name=H.name+".shadowMapDepth",V.map.depthTexture.format=jn,V.map.depthTexture.compareFunction=null,V.map.depthTexture.minFilter=yt,V.map.depthTexture.magFilter=yt}else H.isPointLight?(V.map=new Lc(s.x),V.map.depthTexture=new wo(s.x,Bn)):(V.map=new dn(s.x,s.y),V.map.depthTexture=new fi(s.x,s.y,Bn)),V.map.depthTexture.name=H.name+".shadowMap",V.map.depthTexture.format=jn,this.type===sa?(V.map.depthTexture.compareFunction=Q?Ec:Ac,V.map.depthTexture.minFilter=wt,V.map.depthTexture.magFilter=wt):(V.map.depthTexture.compareFunction=null,V.map.depthTexture.minFilter=yt,V.map.depthTexture.magFilter=yt);V.camera.updateProjectionMatrix()}let le=V.map.isWebGLCubeRenderTarget?6:1;for(let xe=0;xe<le;xe++){if(V.map.isWebGLCubeRenderTarget)i.setRenderTarget(V.map,xe),i.clear();else{xe===0&&(i.setRenderTarget(V.map),i.clear());let Se=V.getViewport(xe);a.set(r.x*Se.x,r.y*Se.y,r.x*Se.z,r.y*Se.w),N.viewport(a)}if(H.isPointLight){let Se=V.camera,Ye=V.matrix,Qe=H.distance||Se.far;Qe!==Se.far&&(Se.far=Qe,Se.updateProjectionMatrix()),ma.setFromMatrixPosition(H.matrixWorld),Se.position.copy(ma),Hh.copy(Se.position),Hh.add(Iy[xe]),Se.up.copy(ky[xe]),Se.lookAt(Hh),Se.updateMatrixWorld(),Ye.makeTranslation(-ma.x,-ma.y,-ma.z),ap.multiplyMatrices(Se.projectionMatrix,Se.matrixWorldInverse),V._frustum.setFromProjectionMatrix(ap,Se.coordinateSystem,Se.reversedDepth)}else V.updateMatrices(H);n=V.getFrustum(),w(R,b,V.camera,H,this.type)}V.isPointLightShadow!==!0&&this.type===ar&&x(V,b),V.needsUpdate=!1}p=this.type,m.needsUpdate=!1,i.setRenderTarget(T,P,C)};function x(S,R){let b=e.update(_);d.defines.VSM_SAMPLES!==S.blurSamples&&(d.defines.VSM_SAMPLES=S.blurSamples,f.defines.VSM_SAMPLES=S.blurSamples,d.needsUpdate=!0,f.needsUpdate=!0),S.mapPass===null&&(S.mapPass=new dn(s.x,s.y,{format:Hi,type:Qn})),d.uniforms.shadow_pass.value=S.map.depthTexture,d.uniforms.resolution.value=S.mapSize,d.uniforms.radius.value=S.radius,i.setRenderTarget(S.mapPass),i.clear(),i.renderBufferDirect(R,null,b,d,_,null),f.uniforms.shadow_pass.value=S.mapPass.texture,f.uniforms.resolution.value=S.mapSize,f.uniforms.radius.value=S.radius,i.setRenderTarget(S.map),i.clear(),i.renderBufferDirect(R,null,b,f,_,null)}function y(S,R,b,T){let P=null,C=b.isPointLight===!0?S.customDistanceMaterial:S.customDepthMaterial;if(C!==void 0)P=C;else if(P=b.isPointLight===!0?c:o,i.localClippingEnabled&&R.clipShadows===!0&&Array.isArray(R.clippingPlanes)&&R.clippingPlanes.length!==0||R.displacementMap&&R.displacementScale!==0||R.alphaMap&&R.alphaTest>0||R.map&&R.alphaTest>0||R.alphaToCoverage===!0){let N=P.uuid,G=R.uuid,q=l[N];q===void 0&&(q={},l[N]=q);let F=q[G];F===void 0&&(F=P.clone(),q[G]=F,R.addEventListener("dispose",A)),P=F}if(P.visible=R.visible,P.wireframe=R.wireframe,T===ar?P.side=R.shadowSide!==null?R.shadowSide:R.side:P.side=R.shadowSide!==null?R.shadowSide:u[R.side],P.alphaMap=R.alphaMap,P.alphaTest=R.alphaToCoverage===!0?.5:R.alphaTest,P.map=R.map,P.clipShadows=R.clipShadows,P.clippingPlanes=R.clippingPlanes,P.clipIntersection=R.clipIntersection,P.displacementMap=R.displacementMap,P.displacementScale=R.displacementScale,P.displacementBias=R.displacementBias,P.wireframeLinewidth=R.wireframeLinewidth,P.linewidth=R.linewidth,b.isPointLight===!0&&P.isMeshDistanceMaterial===!0){let N=i.properties.get(P);N.light=b}return P}function w(S,R,b,T,P){if(S.visible===!1)return;if(S.layers.test(R.layers)&&(S.isMesh||S.isLine||S.isPoints)&&(S.castShadow||S.receiveShadow&&P===ar)&&(!S.frustumCulled||n.intersectsObject(S))){S.modelViewMatrix.multiplyMatrices(b.matrixWorldInverse,S.matrixWorld);let G=e.update(S),q=S.material;if(Array.isArray(q)){let F=G.groups;for(let H=0,V=F.length;H<V;H++){let Z=F[H],Q=q[Z.materialIndex];if(Q&&Q.visible){let le=y(S,Q,T,P);S.onBeforeShadow(i,S,R,b,G,le,Z),i.renderBufferDirect(b,null,G,le,S,Z),S.onAfterShadow(i,S,R,b,G,le,Z)}}}else if(q.visible){let F=y(S,q,T,P);S.onBeforeShadow(i,S,R,b,G,F,null),i.renderBufferDirect(b,null,G,F,S,null),S.onAfterShadow(i,S,R,b,G,F,null)}}let N=S.children;for(let G=0,q=N.length;G<q;G++)w(N[G],R,b,T,P)}function A(S){S.target.removeEventListener("dispose",A);for(let b in l){let T=l[b],P=S.target.uuid;P in T&&(T[P].dispose(),delete T[P])}}}function Fy(i,e){function t(){let I=!1,ne=new st,X=null,pe=new st(0,0,0,0);return{setMask:function(re){X!==re&&!I&&(i.colorMask(re,re,re,re),X=re)},setLocked:function(re){I=re},setClear:function(re,J,we,Fe,bt){bt===!0&&(re*=Fe,J*=Fe,we*=Fe),ne.set(re,J,we,Fe),pe.equals(ne)===!1&&(i.clearColor(re,J,we,Fe),pe.copy(ne))},reset:function(){I=!1,X=null,pe.set(-1,0,0,0)}}}function n(){let I=!1,ne=!1,X=null,pe=null,re=null;return{setReversed:function(J){if(ne!==J){let we=e.get("EXT_clip_control");J?we.clipControlEXT(we.LOWER_LEFT_EXT,we.ZERO_TO_ONE_EXT):we.clipControlEXT(we.LOWER_LEFT_EXT,we.NEGATIVE_ONE_TO_ONE_EXT),ne=J;let Fe=re;re=null,this.setClear(Fe)}},getReversed:function(){return ne},setTest:function(J){J?ie(i.DEPTH_TEST):Re(i.DEPTH_TEST)},setMask:function(J){X!==J&&!I&&(i.depthMask(J),X=J)},setFunc:function(J){if(ne&&(J=Df[J]),pe!==J){switch(J){case oo:i.depthFunc(i.NEVER);break;case co:i.depthFunc(i.ALWAYS);break;case lo:i.depthFunc(i.LESS);break;case ns:i.depthFunc(i.LEQUAL);break;case ho:i.depthFunc(i.EQUAL);break;case uo:i.depthFunc(i.GEQUAL);break;case fo:i.depthFunc(i.GREATER);break;case po:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}pe=J}},setLocked:function(J){I=J},setClear:function(J){re!==J&&(re=J,ne&&(J=1-J),i.clearDepth(J))},reset:function(){I=!1,X=null,pe=null,re=null,ne=!1}}}function s(){let I=!1,ne=null,X=null,pe=null,re=null,J=null,we=null,Fe=null,bt=null;return{setTest:function(tt){I||(tt?ie(i.STENCIL_TEST):Re(i.STENCIL_TEST))},setMask:function(tt){ne!==tt&&!I&&(i.stencilMask(tt),ne=tt)},setFunc:function(tt,ri,Vn){(X!==tt||pe!==ri||re!==Vn)&&(i.stencilFunc(tt,ri,Vn),X=tt,pe=ri,re=Vn)},setOp:function(tt,ri,Vn){(J!==tt||we!==ri||Fe!==Vn)&&(i.stencilOp(tt,ri,Vn),J=tt,we=ri,Fe=Vn)},setLocked:function(tt){I=tt},setClear:function(tt){bt!==tt&&(i.clearStencil(tt),bt=tt)},reset:function(){I=!1,ne=null,X=null,pe=null,re=null,J=null,we=null,Fe=null,bt=null}}}let r=new t,a=new n,o=new s,c=new WeakMap,l=new WeakMap,h={},u={},d={},f=new WeakMap,g=[],_=null,m=!1,p=null,x=null,y=null,w=null,A=null,S=null,R=null,b=new Ee(0,0,0),T=0,P=!1,C=null,N=null,G=null,q=null,F=null,H=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS),V=!1,Z=0,Q=i.getParameter(i.VERSION);Q.indexOf("WebGL")!==-1?(Z=parseFloat(/^WebGL (\d)/.exec(Q)[1]),V=Z>=1):Q.indexOf("OpenGL ES")!==-1&&(Z=parseFloat(/^OpenGL ES (\d)/.exec(Q)[1]),V=Z>=2);let le=null,xe={},Se=i.getParameter(i.SCISSOR_BOX),Ye=i.getParameter(i.VIEWPORT),Qe=new st().fromArray(Se),Ue=new st().fromArray(Ye);function K(I,ne,X,pe){let re=new Uint8Array(4),J=i.createTexture();i.bindTexture(I,J),i.texParameteri(I,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(I,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let we=0;we<X;we++)I===i.TEXTURE_3D||I===i.TEXTURE_2D_ARRAY?i.texImage3D(ne,0,i.RGBA,1,1,pe,0,i.RGBA,i.UNSIGNED_BYTE,re):i.texImage2D(ne+we,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,re);return J}let de={};de[i.TEXTURE_2D]=K(i.TEXTURE_2D,i.TEXTURE_2D,1),de[i.TEXTURE_CUBE_MAP]=K(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),de[i.TEXTURE_2D_ARRAY]=K(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),de[i.TEXTURE_3D]=K(i.TEXTURE_3D,i.TEXTURE_3D,1,1),r.setClear(0,0,0,1),a.setClear(1),o.setClear(0),ie(i.DEPTH_TEST),a.setFunc(ns),Ct(!1),pt(nh),ie(i.CULL_FACE),dt(Zn);function ie(I){h[I]!==!0&&(i.enable(I),h[I]=!0)}function Re(I){h[I]!==!1&&(i.disable(I),h[I]=!1)}function De(I,ne){return d[I]!==ne?(i.bindFramebuffer(I,ne),d[I]=ne,I===i.DRAW_FRAMEBUFFER&&(d[i.FRAMEBUFFER]=ne),I===i.FRAMEBUFFER&&(d[i.DRAW_FRAMEBUFFER]=ne),!0):!1}function Ce(I,ne){let X=g,pe=!1;if(I){X=f.get(ne),X===void 0&&(X=[],f.set(ne,X));let re=I.textures;if(X.length!==re.length||X[0]!==i.COLOR_ATTACHMENT0){for(let J=0,we=re.length;J<we;J++)X[J]=i.COLOR_ATTACHMENT0+J;X.length=re.length,pe=!0}}else X[0]!==i.BACK&&(X[0]=i.BACK,pe=!0);pe&&i.drawBuffers(X)}function ft(I){return _!==I?(i.useProgram(I),_=I,!0):!1}let Xe={[Li]:i.FUNC_ADD,[ef]:i.FUNC_SUBTRACT,[tf]:i.FUNC_REVERSE_SUBTRACT};Xe[nf]=i.MIN,Xe[sf]=i.MAX;let et={[rf]:i.ZERO,[af]:i.ONE,[of]:i.SRC_COLOR,[ro]:i.SRC_ALPHA,[ff]:i.SRC_ALPHA_SATURATE,[uf]:i.DST_COLOR,[lf]:i.DST_ALPHA,[cf]:i.ONE_MINUS_SRC_COLOR,[ao]:i.ONE_MINUS_SRC_ALPHA,[df]:i.ONE_MINUS_DST_COLOR,[hf]:i.ONE_MINUS_DST_ALPHA,[pf]:i.CONSTANT_COLOR,[mf]:i.ONE_MINUS_CONSTANT_COLOR,[gf]:i.CONSTANT_ALPHA,[_f]:i.ONE_MINUS_CONSTANT_ALPHA};function dt(I,ne,X,pe,re,J,we,Fe,bt,tt){if(I===Zn){m===!0&&(Re(i.BLEND),m=!1);return}if(m===!1&&(ie(i.BLEND),m=!0),I!==Qd){if(I!==p||tt!==P){if((x!==Li||A!==Li)&&(i.blendEquation(i.FUNC_ADD),x=Li,A=Li),tt)switch(I){case ts:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case ih:i.blendFunc(i.ONE,i.ONE);break;case sh:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case rh:i.blendFuncSeparate(i.DST_COLOR,i.ONE_MINUS_SRC_ALPHA,i.ZERO,i.ONE);break;default:Te("WebGLState: Invalid blending: ",I);break}else switch(I){case ts:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case ih:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE,i.ONE,i.ONE);break;case sh:Te("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case rh:Te("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:Te("WebGLState: Invalid blending: ",I);break}y=null,w=null,S=null,R=null,b.set(0,0,0),T=0,p=I,P=tt}return}re=re||ne,J=J||X,we=we||pe,(ne!==x||re!==A)&&(i.blendEquationSeparate(Xe[ne],Xe[re]),x=ne,A=re),(X!==y||pe!==w||J!==S||we!==R)&&(i.blendFuncSeparate(et[X],et[pe],et[J],et[we]),y=X,w=pe,S=J,R=we),(Fe.equals(b)===!1||bt!==T)&&(i.blendColor(Fe.r,Fe.g,Fe.b,bt),b.copy(Fe),T=bt),p=I,P=!1}function Ge(I,ne){I.side===rn?Re(i.CULL_FACE):ie(i.CULL_FACE);let X=I.side===Zt;ne&&(X=!X),Ct(X),I.blending===ts&&I.transparent===!1?dt(Zn):dt(I.blending,I.blendEquation,I.blendSrc,I.blendDst,I.blendEquationAlpha,I.blendSrcAlpha,I.blendDstAlpha,I.blendColor,I.blendAlpha,I.premultipliedAlpha),a.setFunc(I.depthFunc),a.setTest(I.depthTest),a.setMask(I.depthWrite),r.setMask(I.colorWrite);let pe=I.stencilWrite;o.setTest(pe),pe&&(o.setMask(I.stencilWriteMask),o.setFunc(I.stencilFunc,I.stencilRef,I.stencilFuncMask),o.setOp(I.stencilFail,I.stencilZFail,I.stencilZPass)),k(I.polygonOffset,I.polygonOffsetFactor,I.polygonOffsetUnits),I.alphaToCoverage===!0?ie(i.SAMPLE_ALPHA_TO_COVERAGE):Re(i.SAMPLE_ALPHA_TO_COVERAGE)}function Ct(I){C!==I&&(I?i.frontFace(i.CW):i.frontFace(i.CCW),C=I)}function pt(I){I!==Jd?(ie(i.CULL_FACE),I!==N&&(I===nh?i.cullFace(i.BACK):I===$d?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):Re(i.CULL_FACE),N=I}function cn(I){I!==G&&(V&&i.lineWidth(I),G=I)}function k(I,ne,X){I?(ie(i.POLYGON_OFFSET_FILL),(q!==ne||F!==X)&&(q=ne,F=X,a.getReversed()&&(ne=-ne),i.polygonOffset(ne,X))):Re(i.POLYGON_OFFSET_FILL)}function Lt(I){I?ie(i.SCISSOR_TEST):Re(i.SCISSOR_TEST)}function je(I){I===void 0&&(I=i.TEXTURE0+H-1),le!==I&&(i.activeTexture(I),le=I)}function ht(I,ne,X){X===void 0&&(le===null?X=i.TEXTURE0+H-1:X=le);let pe=xe[X];pe===void 0&&(pe={type:void 0,texture:void 0},xe[X]=pe),(pe.type!==I||pe.texture!==ne)&&(le!==X&&(i.activeTexture(X),le=X),i.bindTexture(I,ne||de[I]),pe.type=I,pe.texture=ne)}function oe(){let I=xe[le];I!==void 0&&I.type!==void 0&&(i.bindTexture(I.type,null),I.type=void 0,I.texture=void 0)}function mt(){try{i.compressedTexImage2D(...arguments)}catch(I){Te("WebGLState:",I)}}function E(){try{i.compressedTexImage3D(...arguments)}catch(I){Te("WebGLState:",I)}}function v(){try{i.texSubImage2D(...arguments)}catch(I){Te("WebGLState:",I)}}function U(){try{i.texSubImage3D(...arguments)}catch(I){Te("WebGLState:",I)}}function j(){try{i.compressedTexSubImage2D(...arguments)}catch(I){Te("WebGLState:",I)}}function $(){try{i.compressedTexSubImage3D(...arguments)}catch(I){Te("WebGLState:",I)}}function ee(){try{i.texStorage2D(...arguments)}catch(I){Te("WebGLState:",I)}}function ae(){try{i.texStorage3D(...arguments)}catch(I){Te("WebGLState:",I)}}function W(){try{i.texImage2D(...arguments)}catch(I){Te("WebGLState:",I)}}function Y(){try{i.texImage3D(...arguments)}catch(I){Te("WebGLState:",I)}}function fe(I){return u[I]!==void 0?u[I]:i.getParameter(I)}function _e(I,ne){u[I]!==ne&&(i.pixelStorei(I,ne),u[I]=ne)}function se(I){Qe.equals(I)===!1&&(i.scissor(I.x,I.y,I.z,I.w),Qe.copy(I))}function te(I){Ue.equals(I)===!1&&(i.viewport(I.x,I.y,I.z,I.w),Ue.copy(I))}function Pe(I,ne){let X=l.get(ne);X===void 0&&(X=new WeakMap,l.set(ne,X));let pe=X.get(I);pe===void 0&&(pe=i.getUniformBlockIndex(ne,I.name),X.set(I,pe))}function Oe(I,ne){let pe=l.get(ne).get(I);c.get(ne)!==pe&&(i.uniformBlockBinding(ne,pe,I.__bindingPointIndex),c.set(ne,pe))}function Je(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),a.setReversed(!1),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),i.pixelStorei(i.PACK_ALIGNMENT,4),i.pixelStorei(i.UNPACK_ALIGNMENT,4),i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,!1),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,i.BROWSER_DEFAULT_WEBGL),i.pixelStorei(i.PACK_ROW_LENGTH,0),i.pixelStorei(i.PACK_SKIP_PIXELS,0),i.pixelStorei(i.PACK_SKIP_ROWS,0),i.pixelStorei(i.UNPACK_ROW_LENGTH,0),i.pixelStorei(i.UNPACK_IMAGE_HEIGHT,0),i.pixelStorei(i.UNPACK_SKIP_PIXELS,0),i.pixelStorei(i.UNPACK_SKIP_ROWS,0),i.pixelStorei(i.UNPACK_SKIP_IMAGES,0),h={},u={},le=null,xe={},d={},f=new WeakMap,g=[],_=null,m=!1,p=null,x=null,y=null,w=null,A=null,S=null,R=null,b=new Ee(0,0,0),T=0,P=!1,C=null,N=null,G=null,q=null,F=null,Qe.set(0,0,i.canvas.width,i.canvas.height),Ue.set(0,0,i.canvas.width,i.canvas.height),r.reset(),a.reset(),o.reset()}return{buffers:{color:r,depth:a,stencil:o},enable:ie,disable:Re,bindFramebuffer:De,drawBuffers:Ce,useProgram:ft,setBlending:dt,setMaterial:Ge,setFlipSided:Ct,setCullFace:pt,setLineWidth:cn,setPolygonOffset:k,setScissorTest:Lt,activeTexture:je,bindTexture:ht,unbindTexture:oe,compressedTexImage2D:mt,compressedTexImage3D:E,texImage2D:W,texImage3D:Y,pixelStorei:_e,getParameter:fe,updateUBOMapping:Pe,uniformBlockBinding:Oe,texStorage2D:ee,texStorage3D:ae,texSubImage2D:v,texSubImage3D:U,compressedTexSubImage2D:j,compressedTexSubImage3D:$,scissor:se,viewport:te,reset:Je}}function Ny(i,e,t,n,s,r,a){let o=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,c=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),l=new Ie,h=new WeakMap,u=new Set,d,f=new WeakMap,g=!1;try{g=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function _(E,v){return g?new OffscreenCanvas(E,v):Xs("canvas")}function m(E,v,U){let j=1,$=mt(E);if(($.width>U||$.height>U)&&(j=U/Math.max($.width,$.height)),j<1)if(typeof HTMLImageElement<"u"&&E instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&E instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&E instanceof ImageBitmap||typeof VideoFrame<"u"&&E instanceof VideoFrame){let ee=Math.floor(j*$.width),ae=Math.floor(j*$.height);d===void 0&&(d=_(ee,ae));let W=v?_(ee,ae):d;return W.width=ee,W.height=ae,W.getContext("2d").drawImage(E,0,0,ee,ae),ye("WebGLRenderer: Texture has been resized from ("+$.width+"x"+$.height+") to ("+ee+"x"+ae+")."),W}else return"data"in E&&ye("WebGLRenderer: Image in DataTexture is too big ("+$.width+"x"+$.height+")."),E;return E}function p(E){return E.generateMipmaps}function x(E){i.generateMipmap(E)}function y(E){return E.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:E.isWebGL3DRenderTarget?i.TEXTURE_3D:E.isWebGLArrayRenderTarget||E.isCompressedArrayTexture?i.TEXTURE_2D_ARRAY:i.TEXTURE_2D}function w(E,v,U,j,$,ee=!1){if(E!==null){if(i[E]!==void 0)return i[E];ye("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+E+"'")}let ae;j&&(ae=e.get("EXT_texture_norm16"),ae||ye("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let W=v;if(v===i.RED&&(U===i.FLOAT&&(W=i.R32F),U===i.HALF_FLOAT&&(W=i.R16F),U===i.UNSIGNED_BYTE&&(W=i.R8),U===i.UNSIGNED_SHORT&&ae&&(W=ae.R16_EXT),U===i.SHORT&&ae&&(W=ae.R16_SNORM_EXT)),v===i.RED_INTEGER&&(U===i.UNSIGNED_BYTE&&(W=i.R8UI),U===i.UNSIGNED_SHORT&&(W=i.R16UI),U===i.UNSIGNED_INT&&(W=i.R32UI),U===i.BYTE&&(W=i.R8I),U===i.SHORT&&(W=i.R16I),U===i.INT&&(W=i.R32I)),v===i.RG&&(U===i.FLOAT&&(W=i.RG32F),U===i.HALF_FLOAT&&(W=i.RG16F),U===i.UNSIGNED_BYTE&&(W=i.RG8),U===i.UNSIGNED_SHORT&&ae&&(W=ae.RG16_EXT),U===i.SHORT&&ae&&(W=ae.RG16_SNORM_EXT)),v===i.RG_INTEGER&&(U===i.UNSIGNED_BYTE&&(W=i.RG8UI),U===i.UNSIGNED_SHORT&&(W=i.RG16UI),U===i.UNSIGNED_INT&&(W=i.RG32UI),U===i.BYTE&&(W=i.RG8I),U===i.SHORT&&(W=i.RG16I),U===i.INT&&(W=i.RG32I)),v===i.RGB_INTEGER&&(U===i.UNSIGNED_BYTE&&(W=i.RGB8UI),U===i.UNSIGNED_SHORT&&(W=i.RGB16UI),U===i.UNSIGNED_INT&&(W=i.RGB32UI),U===i.BYTE&&(W=i.RGB8I),U===i.SHORT&&(W=i.RGB16I),U===i.INT&&(W=i.RGB32I)),v===i.RGBA_INTEGER&&(U===i.UNSIGNED_BYTE&&(W=i.RGBA8UI),U===i.UNSIGNED_SHORT&&(W=i.RGBA16UI),U===i.UNSIGNED_INT&&(W=i.RGBA32UI),U===i.BYTE&&(W=i.RGBA8I),U===i.SHORT&&(W=i.RGBA16I),U===i.INT&&(W=i.RGBA32I)),v===i.RGB&&(U===i.UNSIGNED_SHORT&&ae&&(W=ae.RGB16_EXT),U===i.SHORT&&ae&&(W=ae.RGB16_SNORM_EXT),U===i.UNSIGNED_INT_5_9_9_9_REV&&(W=i.RGB9_E5),U===i.UNSIGNED_INT_10F_11F_11F_REV&&(W=i.R11F_G11F_B10F)),v===i.RGBA){let Y=ee?Fr:ze.getTransfer($);U===i.FLOAT&&(W=i.RGBA32F),U===i.HALF_FLOAT&&(W=i.RGBA16F),U===i.UNSIGNED_BYTE&&(W=Y===$e?i.SRGB8_ALPHA8:i.RGBA8),U===i.UNSIGNED_SHORT&&ae&&(W=ae.RGBA16_EXT),U===i.SHORT&&ae&&(W=ae.RGBA16_SNORM_EXT),U===i.UNSIGNED_SHORT_4_4_4_4&&(W=i.RGBA4),U===i.UNSIGNED_SHORT_5_5_5_1&&(W=i.RGB5_A1)}return(W===i.R16F||W===i.R32F||W===i.RG16F||W===i.RG32F||W===i.RGBA16F||W===i.RGBA32F)&&e.get("EXT_color_buffer_float"),W}function A(E,v){let U;return E?v===null||v===Bn||v===lr?U=i.DEPTH24_STENCIL8:v===mn?U=i.DEPTH32F_STENCIL8:v===cr&&(U=i.DEPTH24_STENCIL8,ye("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):v===null||v===Bn||v===lr?U=i.DEPTH_COMPONENT24:v===mn?U=i.DEPTH_COMPONENT32F:v===cr&&(U=i.DEPTH_COMPONENT16),U}function S(E,v){return p(E)===!0||E.isFramebufferTexture&&E.minFilter!==yt&&E.minFilter!==wt?Math.log2(Math.max(v.width,v.height))+1:E.mipmaps!==void 0&&E.mipmaps.length>0?E.mipmaps.length:E.isCompressedTexture&&Array.isArray(E.image)?v.mipmaps.length:1}function R(E){let v=E.target;v.removeEventListener("dispose",R),T(v),v.isVideoTexture&&h.delete(v),v.isHTMLTexture&&u.delete(v)}function b(E){let v=E.target;v.removeEventListener("dispose",b),C(v)}function T(E){let v=n.get(E);if(v.__webglInit===void 0)return;let U=E.source,j=f.get(U);if(j){let $=j[v.__cacheKey];$.usedTimes--,$.usedTimes===0&&P(E),Object.keys(j).length===0&&f.delete(U)}n.remove(E)}function P(E){let v=n.get(E);i.deleteTexture(v.__webglTexture);let U=E.source,j=f.get(U);delete j[v.__cacheKey],a.memory.textures--}function C(E){let v=n.get(E);if(E.depthTexture&&(E.depthTexture.dispose(),n.remove(E.depthTexture)),E.isWebGLCubeRenderTarget)for(let j=0;j<6;j++){if(Array.isArray(v.__webglFramebuffer[j]))for(let $=0;$<v.__webglFramebuffer[j].length;$++)i.deleteFramebuffer(v.__webglFramebuffer[j][$]);else i.deleteFramebuffer(v.__webglFramebuffer[j]);v.__webglDepthbuffer&&i.deleteRenderbuffer(v.__webglDepthbuffer[j])}else{if(Array.isArray(v.__webglFramebuffer))for(let j=0;j<v.__webglFramebuffer.length;j++)i.deleteFramebuffer(v.__webglFramebuffer[j]);else i.deleteFramebuffer(v.__webglFramebuffer);if(v.__webglDepthbuffer&&i.deleteRenderbuffer(v.__webglDepthbuffer),v.__webglMultisampledFramebuffer&&i.deleteFramebuffer(v.__webglMultisampledFramebuffer),v.__webglColorRenderbuffer)for(let j=0;j<v.__webglColorRenderbuffer.length;j++)v.__webglColorRenderbuffer[j]&&i.deleteRenderbuffer(v.__webglColorRenderbuffer[j]);v.__webglDepthRenderbuffer&&i.deleteRenderbuffer(v.__webglDepthRenderbuffer)}let U=E.textures;for(let j=0,$=U.length;j<$;j++){let ee=n.get(U[j]);ee.__webglTexture&&(i.deleteTexture(ee.__webglTexture),a.memory.textures--),n.remove(U[j])}n.remove(E)}let N=0;function G(){N=0}function q(){return N}function F(E){N=E}function H(){let E=N;return E>=s.maxTextures&&ye("WebGLTextures: Trying to use "+E+" texture units while this GPU supports only "+s.maxTextures),N+=1,E}function V(E){let v=[];return v.push(E.wrapS),v.push(E.wrapT),v.push(E.wrapR||0),v.push(E.magFilter),v.push(E.minFilter),v.push(E.anisotropy),v.push(E.internalFormat),v.push(E.format),v.push(E.type),v.push(E.generateMipmaps),v.push(E.premultiplyAlpha),v.push(E.flipY),v.push(E.unpackAlignment),v.push(E.colorSpace),v.join()}function Z(E,v){let U=n.get(E);if(E.isVideoTexture&&ht(E),E.isRenderTargetTexture===!1&&E.isExternalTexture!==!0&&E.version>0&&U.__version!==E.version){let j=E.image;if(j===null)ye("WebGLRenderer: Texture marked for update but no image data found.");else if(j.complete===!1)ye("WebGLRenderer: Texture marked for update but image is incomplete");else{Re(U,E,v);return}}else E.isExternalTexture&&(U.__webglTexture=E.sourceTexture?E.sourceTexture:null);t.bindTexture(i.TEXTURE_2D,U.__webglTexture,i.TEXTURE0+v)}function Q(E,v){let U=n.get(E);if(E.isRenderTargetTexture===!1&&E.version>0&&U.__version!==E.version){Re(U,E,v);return}else E.isExternalTexture&&(U.__webglTexture=E.sourceTexture?E.sourceTexture:null);t.bindTexture(i.TEXTURE_2D_ARRAY,U.__webglTexture,i.TEXTURE0+v)}function le(E,v){let U=n.get(E);if(E.isRenderTargetTexture===!1&&E.version>0&&U.__version!==E.version){Re(U,E,v);return}t.bindTexture(i.TEXTURE_3D,U.__webglTexture,i.TEXTURE0+v)}function xe(E,v){let U=n.get(E);if(E.isCubeDepthTexture!==!0&&E.version>0&&U.__version!==E.version){De(U,E,v);return}t.bindTexture(i.TEXTURE_CUBE_MAP,U.__webglTexture,i.TEXTURE0+v)}let Se={[Pi]:i.REPEAT,[wn]:i.CLAMP_TO_EDGE,[Ws]:i.MIRRORED_REPEAT},Ye={[yt]:i.NEAREST,[Bo]:i.NEAREST_MIPMAP_NEAREST,[fs]:i.NEAREST_MIPMAP_LINEAR,[wt]:i.LINEAR,[or]:i.LINEAR_MIPMAP_NEAREST,[On]:i.LINEAR_MIPMAP_LINEAR},Qe={[Sf]:i.NEVER,[Cf]:i.ALWAYS,[Af]:i.LESS,[Ac]:i.LEQUAL,[Ef]:i.EQUAL,[Ec]:i.GEQUAL,[Tf]:i.GREATER,[Rf]:i.NOTEQUAL};function Ue(E,v){if(v.type===mn&&e.has("OES_texture_float_linear")===!1&&(v.magFilter===wt||v.magFilter===or||v.magFilter===fs||v.magFilter===On||v.minFilter===wt||v.minFilter===or||v.minFilter===fs||v.minFilter===On)&&ye("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),i.texParameteri(E,i.TEXTURE_WRAP_S,Se[v.wrapS]),i.texParameteri(E,i.TEXTURE_WRAP_T,Se[v.wrapT]),(E===i.TEXTURE_3D||E===i.TEXTURE_2D_ARRAY)&&i.texParameteri(E,i.TEXTURE_WRAP_R,Se[v.wrapR]),i.texParameteri(E,i.TEXTURE_MAG_FILTER,Ye[v.magFilter]),i.texParameteri(E,i.TEXTURE_MIN_FILTER,Ye[v.minFilter]),v.compareFunction&&(i.texParameteri(E,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(E,i.TEXTURE_COMPARE_FUNC,Qe[v.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(v.magFilter===yt||v.minFilter!==fs&&v.minFilter!==On||v.type===mn&&e.has("OES_texture_float_linear")===!1)return;if(v.anisotropy>1||n.get(v).__currentAnisotropy){let U=e.get("EXT_texture_filter_anisotropic");i.texParameterf(E,U.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(v.anisotropy,s.getMaxAnisotropy())),n.get(v).__currentAnisotropy=v.anisotropy}}}function K(E,v){let U=!1;E.__webglInit===void 0&&(E.__webglInit=!0,v.addEventListener("dispose",R));let j=v.source,$=f.get(j);$===void 0&&($={},f.set(j,$));let ee=V(v);if(ee!==E.__cacheKey){$[ee]===void 0&&($[ee]={texture:i.createTexture(),usedTimes:0},a.memory.textures++,U=!0),$[ee].usedTimes++;let ae=$[E.__cacheKey];ae!==void 0&&($[E.__cacheKey].usedTimes--,ae.usedTimes===0&&P(v)),E.__cacheKey=ee,E.__webglTexture=$[ee].texture}return U}function de(E,v,U){return Math.floor(Math.floor(E/U)/v)}function ie(E,v,U,j){let ee=E.updateRanges;if(ee.length===0)t.texSubImage2D(i.TEXTURE_2D,0,0,0,v.width,v.height,U,j,v.data);else{ee.sort((_e,se)=>_e.start-se.start);let ae=0;for(let _e=1;_e<ee.length;_e++){let se=ee[ae],te=ee[_e],Pe=se.start+se.count,Oe=de(te.start,v.width,4),Je=de(se.start,v.width,4);te.start<=Pe+1&&Oe===Je&&de(te.start+te.count-1,v.width,4)===Oe?se.count=Math.max(se.count,te.start+te.count-se.start):(++ae,ee[ae]=te)}ee.length=ae+1;let W=t.getParameter(i.UNPACK_ROW_LENGTH),Y=t.getParameter(i.UNPACK_SKIP_PIXELS),fe=t.getParameter(i.UNPACK_SKIP_ROWS);t.pixelStorei(i.UNPACK_ROW_LENGTH,v.width);for(let _e=0,se=ee.length;_e<se;_e++){let te=ee[_e],Pe=Math.floor(te.start/4),Oe=Math.ceil(te.count/4),Je=Pe%v.width,I=Math.floor(Pe/v.width),ne=Oe,X=1;t.pixelStorei(i.UNPACK_SKIP_PIXELS,Je),t.pixelStorei(i.UNPACK_SKIP_ROWS,I),t.texSubImage2D(i.TEXTURE_2D,0,Je,I,ne,X,U,j,v.data)}E.clearUpdateRanges(),t.pixelStorei(i.UNPACK_ROW_LENGTH,W),t.pixelStorei(i.UNPACK_SKIP_PIXELS,Y),t.pixelStorei(i.UNPACK_SKIP_ROWS,fe)}}function Re(E,v,U){let j=i.TEXTURE_2D;(v.isDataArrayTexture||v.isCompressedArrayTexture)&&(j=i.TEXTURE_2D_ARRAY),v.isData3DTexture&&(j=i.TEXTURE_3D);let $=K(E,v),ee=v.source;t.bindTexture(j,E.__webglTexture,i.TEXTURE0+U);let ae=n.get(ee);if(ee.version!==ae.__version||$===!0){if(t.activeTexture(i.TEXTURE0+U),(typeof ImageBitmap<"u"&&v.image instanceof ImageBitmap)===!1){let X=ze.getPrimaries(ze.workingColorSpace),pe=v.colorSpace===_i?null:ze.getPrimaries(v.colorSpace),re=v.colorSpace===_i||X===pe?i.NONE:i.BROWSER_DEFAULT_WEBGL;t.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,v.flipY),t.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,v.premultiplyAlpha),t.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,re)}t.pixelStorei(i.UNPACK_ALIGNMENT,v.unpackAlignment);let Y=m(v.image,!1,s.maxTextureSize);Y=oe(v,Y);let fe=r.convert(v.format,v.colorSpace),_e=r.convert(v.type),se=w(v.internalFormat,fe,_e,v.normalized,v.colorSpace,v.isVideoTexture);Ue(j,v);let te,Pe=v.mipmaps,Oe=v.isVideoTexture!==!0,Je=ae.__version===void 0||$===!0,I=ee.dataReady,ne=S(v,Y);if(v.isDepthTexture)se=A(v.format===Bi,v.type),Je&&(Oe?t.texStorage2D(i.TEXTURE_2D,1,se,Y.width,Y.height):t.texImage2D(i.TEXTURE_2D,0,se,Y.width,Y.height,0,fe,_e,null));else if(v.isDataTexture)if(Pe.length>0){Oe&&Je&&t.texStorage2D(i.TEXTURE_2D,ne,se,Pe[0].width,Pe[0].height);for(let X=0,pe=Pe.length;X<pe;X++)te=Pe[X],Oe?I&&t.texSubImage2D(i.TEXTURE_2D,X,0,0,te.width,te.height,fe,_e,te.data):t.texImage2D(i.TEXTURE_2D,X,se,te.width,te.height,0,fe,_e,te.data);v.generateMipmaps=!1}else Oe?(Je&&t.texStorage2D(i.TEXTURE_2D,ne,se,Y.width,Y.height),I&&ie(v,Y,fe,_e)):t.texImage2D(i.TEXTURE_2D,0,se,Y.width,Y.height,0,fe,_e,Y.data);else if(v.isCompressedTexture)if(v.isCompressedArrayTexture){Oe&&Je&&t.texStorage3D(i.TEXTURE_2D_ARRAY,ne,se,Pe[0].width,Pe[0].height,Y.depth);for(let X=0,pe=Pe.length;X<pe;X++)if(te=Pe[X],v.format!==gn)if(fe!==null)if(Oe){if(I)if(v.layerUpdates.size>0){let re=Rh(te.width,te.height,v.format,v.type);for(let J of v.layerUpdates){let we=te.data.subarray(J*re/te.data.BYTES_PER_ELEMENT,(J+1)*re/te.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,X,0,0,J,te.width,te.height,1,fe,we)}v.clearLayerUpdates()}else t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,X,0,0,0,te.width,te.height,Y.depth,fe,te.data)}else t.compressedTexImage3D(i.TEXTURE_2D_ARRAY,X,se,te.width,te.height,Y.depth,0,te.data,0,0);else ye("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else Oe?I&&t.texSubImage3D(i.TEXTURE_2D_ARRAY,X,0,0,0,te.width,te.height,Y.depth,fe,_e,te.data):t.texImage3D(i.TEXTURE_2D_ARRAY,X,se,te.width,te.height,Y.depth,0,fe,_e,te.data)}else{Oe&&Je&&t.texStorage2D(i.TEXTURE_2D,ne,se,Pe[0].width,Pe[0].height);for(let X=0,pe=Pe.length;X<pe;X++)te=Pe[X],v.format!==gn?fe!==null?Oe?I&&t.compressedTexSubImage2D(i.TEXTURE_2D,X,0,0,te.width,te.height,fe,te.data):t.compressedTexImage2D(i.TEXTURE_2D,X,se,te.width,te.height,0,te.data):ye("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Oe?I&&t.texSubImage2D(i.TEXTURE_2D,X,0,0,te.width,te.height,fe,_e,te.data):t.texImage2D(i.TEXTURE_2D,X,se,te.width,te.height,0,fe,_e,te.data)}else if(v.isDataArrayTexture)if(Oe){if(Je&&t.texStorage3D(i.TEXTURE_2D_ARRAY,ne,se,Y.width,Y.height,Y.depth),I)if(v.layerUpdates.size>0){let X=Rh(Y.width,Y.height,v.format,v.type);for(let pe of v.layerUpdates){let re=Y.data.subarray(pe*X/Y.data.BYTES_PER_ELEMENT,(pe+1)*X/Y.data.BYTES_PER_ELEMENT);t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,pe,Y.width,Y.height,1,fe,_e,re)}v.clearLayerUpdates()}else t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,Y.width,Y.height,Y.depth,fe,_e,Y.data)}else t.texImage3D(i.TEXTURE_2D_ARRAY,0,se,Y.width,Y.height,Y.depth,0,fe,_e,Y.data);else if(v.isData3DTexture)Oe?(Je&&t.texStorage3D(i.TEXTURE_3D,ne,se,Y.width,Y.height,Y.depth),I&&t.texSubImage3D(i.TEXTURE_3D,0,0,0,0,Y.width,Y.height,Y.depth,fe,_e,Y.data)):t.texImage3D(i.TEXTURE_3D,0,se,Y.width,Y.height,Y.depth,0,fe,_e,Y.data);else if(v.isFramebufferTexture){if(Je)if(Oe)t.texStorage2D(i.TEXTURE_2D,ne,se,Y.width,Y.height);else{let X=Y.width,pe=Y.height;for(let re=0;re<ne;re++)t.texImage2D(i.TEXTURE_2D,re,se,X,pe,0,fe,_e,null),X>>=1,pe>>=1}}else if(v.isHTMLTexture){if("texElementImage2D"in i){let X=i.canvas;if(X.hasAttribute("layoutsubtree")||X.setAttribute("layoutsubtree","true"),Y.parentNode!==X){X.appendChild(Y),u.add(v),X.onpaint=Fe=>{let bt=Fe.changedElements;for(let tt of u)bt.includes(tt.image)&&(tt.needsUpdate=!0)},X.requestPaint();return}let pe=0,re=i.RGBA,J=i.RGBA,we=i.UNSIGNED_BYTE;i.texElementImage2D(i.TEXTURE_2D,pe,re,J,we,Y),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MIN_FILTER,i.LINEAR),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE)}}else if(Pe.length>0){if(Oe&&Je){let X=mt(Pe[0]);t.texStorage2D(i.TEXTURE_2D,ne,se,X.width,X.height)}for(let X=0,pe=Pe.length;X<pe;X++)te=Pe[X],Oe?I&&t.texSubImage2D(i.TEXTURE_2D,X,0,0,fe,_e,te):t.texImage2D(i.TEXTURE_2D,X,se,fe,_e,te);v.generateMipmaps=!1}else if(Oe){if(Je){let X=mt(Y);t.texStorage2D(i.TEXTURE_2D,ne,se,X.width,X.height)}I&&t.texSubImage2D(i.TEXTURE_2D,0,0,0,fe,_e,Y)}else t.texImage2D(i.TEXTURE_2D,0,se,fe,_e,Y);p(v)&&x(j),ae.__version=ee.version,v.onUpdate&&v.onUpdate(v)}E.__version=v.version}function De(E,v,U){if(v.image.length!==6)return;let j=K(E,v),$=v.source;t.bindTexture(i.TEXTURE_CUBE_MAP,E.__webglTexture,i.TEXTURE0+U);let ee=n.get($);if($.version!==ee.__version||j===!0){t.activeTexture(i.TEXTURE0+U);let ae=ze.getPrimaries(ze.workingColorSpace),W=v.colorSpace===_i?null:ze.getPrimaries(v.colorSpace),Y=v.colorSpace===_i||ae===W?i.NONE:i.BROWSER_DEFAULT_WEBGL;t.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,v.flipY),t.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,v.premultiplyAlpha),t.pixelStorei(i.UNPACK_ALIGNMENT,v.unpackAlignment),t.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,Y);let fe=v.isCompressedTexture||v.image[0].isCompressedTexture,_e=v.image[0]&&v.image[0].isDataTexture,se=[];for(let J=0;J<6;J++)!fe&&!_e?se[J]=m(v.image[J],!0,s.maxCubemapSize):se[J]=_e?v.image[J].image:v.image[J],se[J]=oe(v,se[J]);let te=se[0],Pe=r.convert(v.format,v.colorSpace),Oe=r.convert(v.type),Je=w(v.internalFormat,Pe,Oe,v.normalized,v.colorSpace),I=v.isVideoTexture!==!0,ne=ee.__version===void 0||j===!0,X=$.dataReady,pe=S(v,te);Ue(i.TEXTURE_CUBE_MAP,v);let re;if(fe){I&&ne&&t.texStorage2D(i.TEXTURE_CUBE_MAP,pe,Je,te.width,te.height);for(let J=0;J<6;J++){re=se[J].mipmaps;for(let we=0;we<re.length;we++){let Fe=re[we];v.format!==gn?Pe!==null?I?X&&t.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+J,we,0,0,Fe.width,Fe.height,Pe,Fe.data):t.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+J,we,Je,Fe.width,Fe.height,0,Fe.data):ye("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):I?X&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+J,we,0,0,Fe.width,Fe.height,Pe,Oe,Fe.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+J,we,Je,Fe.width,Fe.height,0,Pe,Oe,Fe.data)}}}else{if(re=v.mipmaps,I&&ne){re.length>0&&pe++;let J=mt(se[0]);t.texStorage2D(i.TEXTURE_CUBE_MAP,pe,Je,J.width,J.height)}for(let J=0;J<6;J++)if(_e){I?X&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+J,0,0,0,se[J].width,se[J].height,Pe,Oe,se[J].data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+J,0,Je,se[J].width,se[J].height,0,Pe,Oe,se[J].data);for(let we=0;we<re.length;we++){let bt=re[we].image[J].image;I?X&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+J,we+1,0,0,bt.width,bt.height,Pe,Oe,bt.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+J,we+1,Je,bt.width,bt.height,0,Pe,Oe,bt.data)}}else{I?X&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+J,0,0,0,Pe,Oe,se[J]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+J,0,Je,Pe,Oe,se[J]);for(let we=0;we<re.length;we++){let Fe=re[we];I?X&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+J,we+1,0,0,Pe,Oe,Fe.image[J]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+J,we+1,Je,Pe,Oe,Fe.image[J])}}}p(v)&&x(i.TEXTURE_CUBE_MAP),ee.__version=$.version,v.onUpdate&&v.onUpdate(v)}E.__version=v.version}function Ce(E,v,U,j,$,ee){let ae=r.convert(U.format,U.colorSpace),W=r.convert(U.type),Y=w(U.internalFormat,ae,W,U.normalized,U.colorSpace),fe=n.get(v),_e=n.get(U);if(_e.__renderTarget=v,!fe.__hasExternalTextures){let se=Math.max(1,v.width>>ee),te=Math.max(1,v.height>>ee);$===i.TEXTURE_3D||$===i.TEXTURE_2D_ARRAY?t.texImage3D($,ee,Y,se,te,v.depth,0,ae,W,null):t.texImage2D($,ee,Y,se,te,0,ae,W,null)}t.bindFramebuffer(i.FRAMEBUFFER,E),je(v)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,j,$,_e.__webglTexture,0,Lt(v)):($===i.TEXTURE_2D||$>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&$<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,j,$,_e.__webglTexture,ee),t.bindFramebuffer(i.FRAMEBUFFER,null)}function ft(E,v,U){if(i.bindRenderbuffer(i.RENDERBUFFER,E),v.depthBuffer){let j=v.depthTexture,$=j&&j.isDepthTexture?j.type:null,ee=A(v.stencilBuffer,$),ae=v.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;je(v)?o.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,Lt(v),ee,v.width,v.height):U?i.renderbufferStorageMultisample(i.RENDERBUFFER,Lt(v),ee,v.width,v.height):i.renderbufferStorage(i.RENDERBUFFER,ee,v.width,v.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,ae,i.RENDERBUFFER,E)}else{let j=v.textures;for(let $=0;$<j.length;$++){let ee=j[$],ae=r.convert(ee.format,ee.colorSpace),W=r.convert(ee.type),Y=w(ee.internalFormat,ae,W,ee.normalized,ee.colorSpace);je(v)?o.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,Lt(v),Y,v.width,v.height):U?i.renderbufferStorageMultisample(i.RENDERBUFFER,Lt(v),Y,v.width,v.height):i.renderbufferStorage(i.RENDERBUFFER,Y,v.width,v.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function Xe(E,v,U){let j=v.isWebGLCubeRenderTarget===!0;if(t.bindFramebuffer(i.FRAMEBUFFER,E),!(v.depthTexture&&v.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");let $=n.get(v.depthTexture);if($.__renderTarget=v,(!$.__webglTexture||v.depthTexture.image.width!==v.width||v.depthTexture.image.height!==v.height)&&(v.depthTexture.image.width=v.width,v.depthTexture.image.height=v.height,v.depthTexture.needsUpdate=!0),j){if($.__webglInit===void 0&&($.__webglInit=!0,v.depthTexture.addEventListener("dispose",R)),$.__webglTexture===void 0){$.__webglTexture=i.createTexture(),t.bindTexture(i.TEXTURE_CUBE_MAP,$.__webglTexture),Ue(i.TEXTURE_CUBE_MAP,v.depthTexture);let fe=r.convert(v.depthTexture.format),_e=r.convert(v.depthTexture.type),se;v.depthTexture.format===jn?se=i.DEPTH_COMPONENT24:v.depthTexture.format===Bi&&(se=i.DEPTH24_STENCIL8);for(let te=0;te<6;te++)i.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+te,0,se,v.width,v.height,0,fe,_e,null)}}else Z(v.depthTexture,0);let ee=$.__webglTexture,ae=Lt(v),W=j?i.TEXTURE_CUBE_MAP_POSITIVE_X+U:i.TEXTURE_2D,Y=v.depthTexture.format===Bi?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;if(v.depthTexture.format===jn)je(v)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,Y,W,ee,0,ae):i.framebufferTexture2D(i.FRAMEBUFFER,Y,W,ee,0);else if(v.depthTexture.format===Bi)je(v)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,Y,W,ee,0,ae):i.framebufferTexture2D(i.FRAMEBUFFER,Y,W,ee,0);else throw new Error("Unknown depthTexture format")}function et(E){let v=n.get(E),U=E.isWebGLCubeRenderTarget===!0;if(v.__boundDepthTexture!==E.depthTexture){let j=E.depthTexture;if(v.__depthDisposeCallback&&v.__depthDisposeCallback(),j){let $=()=>{delete v.__boundDepthTexture,delete v.__depthDisposeCallback,j.removeEventListener("dispose",$)};j.addEventListener("dispose",$),v.__depthDisposeCallback=$}v.__boundDepthTexture=j}if(E.depthTexture&&!v.__autoAllocateDepthBuffer)if(U)for(let j=0;j<6;j++)Xe(v.__webglFramebuffer[j],E,j);else{let j=E.texture.mipmaps;j&&j.length>0?Xe(v.__webglFramebuffer[0],E,0):Xe(v.__webglFramebuffer,E,0)}else if(U){v.__webglDepthbuffer=[];for(let j=0;j<6;j++)if(t.bindFramebuffer(i.FRAMEBUFFER,v.__webglFramebuffer[j]),v.__webglDepthbuffer[j]===void 0)v.__webglDepthbuffer[j]=i.createRenderbuffer(),ft(v.__webglDepthbuffer[j],E,!1);else{let $=E.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,ee=v.__webglDepthbuffer[j];i.bindRenderbuffer(i.RENDERBUFFER,ee),i.framebufferRenderbuffer(i.FRAMEBUFFER,$,i.RENDERBUFFER,ee)}}else{let j=E.texture.mipmaps;if(j&&j.length>0?t.bindFramebuffer(i.FRAMEBUFFER,v.__webglFramebuffer[0]):t.bindFramebuffer(i.FRAMEBUFFER,v.__webglFramebuffer),v.__webglDepthbuffer===void 0)v.__webglDepthbuffer=i.createRenderbuffer(),ft(v.__webglDepthbuffer,E,!1);else{let $=E.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,ee=v.__webglDepthbuffer;i.bindRenderbuffer(i.RENDERBUFFER,ee),i.framebufferRenderbuffer(i.FRAMEBUFFER,$,i.RENDERBUFFER,ee)}}t.bindFramebuffer(i.FRAMEBUFFER,null)}function dt(E,v,U){let j=n.get(E);v!==void 0&&Ce(j.__webglFramebuffer,E,E.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),U!==void 0&&et(E)}function Ge(E){let v=E.texture,U=n.get(E),j=n.get(v);E.addEventListener("dispose",b);let $=E.textures,ee=E.isWebGLCubeRenderTarget===!0,ae=$.length>1;if(ae||(j.__webglTexture===void 0&&(j.__webglTexture=i.createTexture()),j.__version=v.version,a.memory.textures++),ee){U.__webglFramebuffer=[];for(let W=0;W<6;W++)if(v.mipmaps&&v.mipmaps.length>0){U.__webglFramebuffer[W]=[];for(let Y=0;Y<v.mipmaps.length;Y++)U.__webglFramebuffer[W][Y]=i.createFramebuffer()}else U.__webglFramebuffer[W]=i.createFramebuffer()}else{if(v.mipmaps&&v.mipmaps.length>0){U.__webglFramebuffer=[];for(let W=0;W<v.mipmaps.length;W++)U.__webglFramebuffer[W]=i.createFramebuffer()}else U.__webglFramebuffer=i.createFramebuffer();if(ae)for(let W=0,Y=$.length;W<Y;W++){let fe=n.get($[W]);fe.__webglTexture===void 0&&(fe.__webglTexture=i.createTexture(),a.memory.textures++)}if(E.samples>0&&je(E)===!1){U.__webglMultisampledFramebuffer=i.createFramebuffer(),U.__webglColorRenderbuffer=[],t.bindFramebuffer(i.FRAMEBUFFER,U.__webglMultisampledFramebuffer);for(let W=0;W<$.length;W++){let Y=$[W];U.__webglColorRenderbuffer[W]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,U.__webglColorRenderbuffer[W]);let fe=r.convert(Y.format,Y.colorSpace),_e=r.convert(Y.type),se=w(Y.internalFormat,fe,_e,Y.normalized,Y.colorSpace,E.isXRRenderTarget===!0),te=Lt(E);i.renderbufferStorageMultisample(i.RENDERBUFFER,te,se,E.width,E.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+W,i.RENDERBUFFER,U.__webglColorRenderbuffer[W])}i.bindRenderbuffer(i.RENDERBUFFER,null),E.depthBuffer&&(U.__webglDepthRenderbuffer=i.createRenderbuffer(),ft(U.__webglDepthRenderbuffer,E,!0)),t.bindFramebuffer(i.FRAMEBUFFER,null)}}if(ee){t.bindTexture(i.TEXTURE_CUBE_MAP,j.__webglTexture),Ue(i.TEXTURE_CUBE_MAP,v);for(let W=0;W<6;W++)if(v.mipmaps&&v.mipmaps.length>0)for(let Y=0;Y<v.mipmaps.length;Y++)Ce(U.__webglFramebuffer[W][Y],E,v,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+W,Y);else Ce(U.__webglFramebuffer[W],E,v,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+W,0);p(v)&&x(i.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(ae){for(let W=0,Y=$.length;W<Y;W++){let fe=$[W],_e=n.get(fe),se=i.TEXTURE_2D;(E.isWebGL3DRenderTarget||E.isWebGLArrayRenderTarget)&&(se=E.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),t.bindTexture(se,_e.__webglTexture),Ue(se,fe),Ce(U.__webglFramebuffer,E,fe,i.COLOR_ATTACHMENT0+W,se,0),p(fe)&&x(se)}t.unbindTexture()}else{let W=i.TEXTURE_2D;if((E.isWebGL3DRenderTarget||E.isWebGLArrayRenderTarget)&&(W=E.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),t.bindTexture(W,j.__webglTexture),Ue(W,v),v.mipmaps&&v.mipmaps.length>0)for(let Y=0;Y<v.mipmaps.length;Y++)Ce(U.__webglFramebuffer[Y],E,v,i.COLOR_ATTACHMENT0,W,Y);else Ce(U.__webglFramebuffer,E,v,i.COLOR_ATTACHMENT0,W,0);p(v)&&x(W),t.unbindTexture()}E.depthBuffer&&et(E)}function Ct(E){let v=E.textures;for(let U=0,j=v.length;U<j;U++){let $=v[U];if(p($)){let ee=y(E),ae=n.get($).__webglTexture;t.bindTexture(ee,ae),x(ee),t.unbindTexture()}}}let pt=[],cn=[];function k(E){if(E.samples>0){if(je(E)===!1){let v=E.textures,U=E.width,j=E.height,$=i.COLOR_BUFFER_BIT,ee=E.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,ae=n.get(E),W=v.length>1;if(W)for(let fe=0;fe<v.length;fe++)t.bindFramebuffer(i.FRAMEBUFFER,ae.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+fe,i.RENDERBUFFER,null),t.bindFramebuffer(i.FRAMEBUFFER,ae.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+fe,i.TEXTURE_2D,null,0);t.bindFramebuffer(i.READ_FRAMEBUFFER,ae.__webglMultisampledFramebuffer);let Y=E.texture.mipmaps;Y&&Y.length>0?t.bindFramebuffer(i.DRAW_FRAMEBUFFER,ae.__webglFramebuffer[0]):t.bindFramebuffer(i.DRAW_FRAMEBUFFER,ae.__webglFramebuffer);for(let fe=0;fe<v.length;fe++){if(E.resolveDepthBuffer&&(E.depthBuffer&&($|=i.DEPTH_BUFFER_BIT),E.stencilBuffer&&E.resolveStencilBuffer&&($|=i.STENCIL_BUFFER_BIT)),W){i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,ae.__webglColorRenderbuffer[fe]);let _e=n.get(v[fe]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,_e,0)}i.blitFramebuffer(0,0,U,j,0,0,U,j,$,i.NEAREST),c===!0&&(pt.length=0,cn.length=0,pt.push(i.COLOR_ATTACHMENT0+fe),E.depthBuffer&&E.resolveDepthBuffer===!1&&(pt.push(ee),cn.push(ee),i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,cn)),i.invalidateFramebuffer(i.READ_FRAMEBUFFER,pt))}if(t.bindFramebuffer(i.READ_FRAMEBUFFER,null),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),W)for(let fe=0;fe<v.length;fe++){t.bindFramebuffer(i.FRAMEBUFFER,ae.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+fe,i.RENDERBUFFER,ae.__webglColorRenderbuffer[fe]);let _e=n.get(v[fe]).__webglTexture;t.bindFramebuffer(i.FRAMEBUFFER,ae.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+fe,i.TEXTURE_2D,_e,0)}t.bindFramebuffer(i.DRAW_FRAMEBUFFER,ae.__webglMultisampledFramebuffer)}else if(E.depthBuffer&&E.resolveDepthBuffer===!1&&c){let v=E.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[v])}}}function Lt(E){return Math.min(s.maxSamples,E.samples)}function je(E){let v=n.get(E);return E.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&v.__useRenderToTexture!==!1}function ht(E){let v=a.render.frame;h.get(E)!==v&&(h.set(E,v),E.update())}function oe(E,v){let U=E.colorSpace,j=E.format,$=E.type;return E.isCompressedTexture===!0||E.isVideoTexture===!0||U!==Jt&&U!==_i&&(ze.getTransfer(U)===$e?(j!==gn||$!==an)&&ye("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):Te("WebGLTextures: Unsupported texture color space:",U)),v}function mt(E){return typeof HTMLImageElement<"u"&&E instanceof HTMLImageElement?(l.width=E.naturalWidth||E.width,l.height=E.naturalHeight||E.height):typeof VideoFrame<"u"&&E instanceof VideoFrame?(l.width=E.displayWidth,l.height=E.displayHeight):(l.width=E.width,l.height=E.height),l}this.allocateTextureUnit=H,this.resetTextureUnits=G,this.getTextureUnits=q,this.setTextureUnits=F,this.setTexture2D=Z,this.setTexture2DArray=Q,this.setTexture3D=le,this.setTextureCube=xe,this.rebindTextures=dt,this.setupRenderTarget=Ge,this.updateRenderTargetMipmap=Ct,this.updateMultisampleRenderTarget=k,this.setupDepthRenderbuffer=et,this.setupFrameBufferTexture=Ce,this.useMultisampledRTT=je,this.isReversedDepthBuffer=function(){return t.buffers.depth.getReversed()}}function Uy(i,e){function t(n,s=_i){let r,a=ze.getTransfer(s);if(n===an)return i.UNSIGNED_BYTE;if(n===zo)return i.UNSIGNED_SHORT_4_4_4_4;if(n===Vo)return i.UNSIGNED_SHORT_5_5_5_1;if(n===_h)return i.UNSIGNED_INT_5_9_9_9_REV;if(n===bh)return i.UNSIGNED_INT_10F_11F_11F_REV;if(n===mh)return i.BYTE;if(n===gh)return i.SHORT;if(n===cr)return i.UNSIGNED_SHORT;if(n===Ho)return i.INT;if(n===Bn)return i.UNSIGNED_INT;if(n===mn)return i.FLOAT;if(n===Qn)return i.HALF_FLOAT;if(n===xh)return i.ALPHA;if(n===vh)return i.RGB;if(n===gn)return i.RGBA;if(n===jn)return i.DEPTH_COMPONENT;if(n===Bi)return i.DEPTH_STENCIL;if(n===Go)return i.RED;if(n===Wo)return i.RED_INTEGER;if(n===Hi)return i.RG;if(n===qo)return i.RG_INTEGER;if(n===Xo)return i.RGBA_INTEGER;if(n===aa||n===oa||n===ca||n===la)if(a===$e)if(r=e.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(n===aa)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===oa)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===ca)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===la)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=e.get("WEBGL_compressed_texture_s3tc"),r!==null){if(n===aa)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===oa)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===ca)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===la)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===jo||n===Yo||n===Ko||n===Jo)if(r=e.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(n===jo)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===Yo)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===Ko)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===Jo)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===$o||n===Zo||n===Qo||n===ec||n===tc||n===ha||n===nc)if(r=e.get("WEBGL_compressed_texture_etc"),r!==null){if(n===$o||n===Zo)return a===$e?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(n===Qo)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC;if(n===ec)return r.COMPRESSED_R11_EAC;if(n===tc)return r.COMPRESSED_SIGNED_R11_EAC;if(n===ha)return r.COMPRESSED_RG11_EAC;if(n===nc)return r.COMPRESSED_SIGNED_RG11_EAC}else return null;if(n===ic||n===sc||n===rc||n===ac||n===oc||n===cc||n===lc||n===hc||n===uc||n===dc||n===fc||n===pc||n===mc||n===gc)if(r=e.get("WEBGL_compressed_texture_astc"),r!==null){if(n===ic)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===sc)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===rc)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===ac)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===oc)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===cc)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===lc)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===hc)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===uc)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===dc)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===fc)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===pc)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===mc)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===gc)return a===$e?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===_c||n===bc||n===xc)if(r=e.get("EXT_texture_compression_bptc"),r!==null){if(n===_c)return a===$e?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===bc)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===xc)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===vc||n===yc||n===ua||n===wc)if(r=e.get("EXT_texture_compression_rgtc"),r!==null){if(n===vc)return r.COMPRESSED_RED_RGTC1_EXT;if(n===yc)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===ua)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===wc)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===lr?i.UNSIGNED_INT_24_8:i[n]!==void 0?i[n]:null}return{convert:t}}function zy(i,e){function t(m,p){m.matrixAutoUpdate===!0&&m.updateMatrix(),p.value.copy(m.matrix)}function n(m,p){p.color.getRGB(m.fogColor.value,Sh(i)),p.isFog?(m.fogNear.value=p.near,m.fogFar.value=p.far):p.isFogExp2&&(m.fogDensity.value=p.density)}function s(m,p,x,y,w){p.isNodeMaterial?p.uniformsNeedUpdate=!1:p.isMeshBasicMaterial?r(m,p):p.isMeshLambertMaterial?(r(m,p),p.envMap&&(m.envMapIntensity.value=p.envMapIntensity)):p.isMeshToonMaterial?(r(m,p),u(m,p)):p.isMeshPhongMaterial?(r(m,p),h(m,p),p.envMap&&(m.envMapIntensity.value=p.envMapIntensity)):p.isMeshStandardMaterial?(r(m,p),d(m,p),p.isMeshPhysicalMaterial&&f(m,p,w)):p.isMeshMatcapMaterial?(r(m,p),g(m,p)):p.isMeshDepthMaterial?r(m,p):p.isMeshDistanceMaterial?(r(m,p),_(m,p)):p.isMeshNormalMaterial?r(m,p):p.isLineBasicMaterial?(a(m,p),p.isLineDashedMaterial&&o(m,p)):p.isPointsMaterial?c(m,p,x,y):p.isSpriteMaterial?l(m,p):p.isShadowMaterial?(m.color.value.copy(p.color),m.opacity.value=p.opacity):p.isShaderMaterial&&(p.uniformsNeedUpdate=!1)}function r(m,p){m.opacity.value=p.opacity,p.color&&m.diffuse.value.copy(p.color),p.emissive&&m.emissive.value.copy(p.emissive).multiplyScalar(p.emissiveIntensity),p.map&&(m.map.value=p.map,t(p.map,m.mapTransform)),p.alphaMap&&(m.alphaMap.value=p.alphaMap,t(p.alphaMap,m.alphaMapTransform)),p.bumpMap&&(m.bumpMap.value=p.bumpMap,t(p.bumpMap,m.bumpMapTransform),m.bumpScale.value=p.bumpScale,p.side===Zt&&(m.bumpScale.value*=-1)),p.normalMap&&(m.normalMap.value=p.normalMap,t(p.normalMap,m.normalMapTransform),m.normalScale.value.copy(p.normalScale),p.side===Zt&&m.normalScale.value.negate()),p.displacementMap&&(m.displacementMap.value=p.displacementMap,t(p.displacementMap,m.displacementMapTransform),m.displacementScale.value=p.displacementScale,m.displacementBias.value=p.displacementBias),p.emissiveMap&&(m.emissiveMap.value=p.emissiveMap,t(p.emissiveMap,m.emissiveMapTransform)),p.specularMap&&(m.specularMap.value=p.specularMap,t(p.specularMap,m.specularMapTransform)),p.alphaTest>0&&(m.alphaTest.value=p.alphaTest);let x=e.get(p),y=x.envMap,w=x.envMapRotation;y&&(m.envMap.value=y,m.envMapRotation.value.setFromMatrix4(Hy.makeRotationFromEuler(w)).transpose(),y.isCubeTexture&&y.isRenderTargetTexture===!1&&m.envMapRotation.value.premultiply(fp),m.reflectivity.value=p.reflectivity,m.ior.value=p.ior,m.refractionRatio.value=p.refractionRatio),p.lightMap&&(m.lightMap.value=p.lightMap,m.lightMapIntensity.value=p.lightMapIntensity,t(p.lightMap,m.lightMapTransform)),p.aoMap&&(m.aoMap.value=p.aoMap,m.aoMapIntensity.value=p.aoMapIntensity,t(p.aoMap,m.aoMapTransform))}function a(m,p){m.diffuse.value.copy(p.color),m.opacity.value=p.opacity,p.map&&(m.map.value=p.map,t(p.map,m.mapTransform))}function o(m,p){m.dashSize.value=p.dashSize,m.totalSize.value=p.dashSize+p.gapSize,m.scale.value=p.scale}function c(m,p,x,y){m.diffuse.value.copy(p.color),m.opacity.value=p.opacity,m.size.value=p.size*x,m.scale.value=y*.5,p.map&&(m.map.value=p.map,t(p.map,m.uvTransform)),p.alphaMap&&(m.alphaMap.value=p.alphaMap,t(p.alphaMap,m.alphaMapTransform)),p.alphaTest>0&&(m.alphaTest.value=p.alphaTest)}function l(m,p){m.diffuse.value.copy(p.color),m.opacity.value=p.opacity,m.rotation.value=p.rotation,p.map&&(m.map.value=p.map,t(p.map,m.mapTransform)),p.alphaMap&&(m.alphaMap.value=p.alphaMap,t(p.alphaMap,m.alphaMapTransform)),p.alphaTest>0&&(m.alphaTest.value=p.alphaTest)}function h(m,p){m.specular.value.copy(p.specular),m.shininess.value=Math.max(p.shininess,1e-4)}function u(m,p){p.gradientMap&&(m.gradientMap.value=p.gradientMap)}function d(m,p){m.metalness.value=p.metalness,p.metalnessMap&&(m.metalnessMap.value=p.metalnessMap,t(p.metalnessMap,m.metalnessMapTransform)),m.roughness.value=p.roughness,p.roughnessMap&&(m.roughnessMap.value=p.roughnessMap,t(p.roughnessMap,m.roughnessMapTransform)),p.envMap&&(m.envMapIntensity.value=p.envMapIntensity)}function f(m,p,x){m.ior.value=p.ior,p.sheen>0&&(m.sheenColor.value.copy(p.sheenColor).multiplyScalar(p.sheen),m.sheenRoughness.value=p.sheenRoughness,p.sheenColorMap&&(m.sheenColorMap.value=p.sheenColorMap,t(p.sheenColorMap,m.sheenColorMapTransform)),p.sheenRoughnessMap&&(m.sheenRoughnessMap.value=p.sheenRoughnessMap,t(p.sheenRoughnessMap,m.sheenRoughnessMapTransform))),p.clearcoat>0&&(m.clearcoat.value=p.clearcoat,m.clearcoatRoughness.value=p.clearcoatRoughness,p.clearcoatMap&&(m.clearcoatMap.value=p.clearcoatMap,t(p.clearcoatMap,m.clearcoatMapTransform)),p.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=p.clearcoatRoughnessMap,t(p.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),p.clearcoatNormalMap&&(m.clearcoatNormalMap.value=p.clearcoatNormalMap,t(p.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(p.clearcoatNormalScale),p.side===Zt&&m.clearcoatNormalScale.value.negate())),p.dispersion>0&&(m.dispersion.value=p.dispersion),p.iridescence>0&&(m.iridescence.value=p.iridescence,m.iridescenceIOR.value=p.iridescenceIOR,m.iridescenceThicknessMinimum.value=p.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=p.iridescenceThicknessRange[1],p.iridescenceMap&&(m.iridescenceMap.value=p.iridescenceMap,t(p.iridescenceMap,m.iridescenceMapTransform)),p.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=p.iridescenceThicknessMap,t(p.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),p.transmission>0&&(m.transmission.value=p.transmission,m.transmissionSamplerMap.value=x.texture,m.transmissionSamplerSize.value.set(x.width,x.height),p.transmissionMap&&(m.transmissionMap.value=p.transmissionMap,t(p.transmissionMap,m.transmissionMapTransform)),m.thickness.value=p.thickness,p.thicknessMap&&(m.thicknessMap.value=p.thicknessMap,t(p.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=p.attenuationDistance,m.attenuationColor.value.copy(p.attenuationColor)),p.anisotropy>0&&(m.anisotropyVector.value.set(p.anisotropy*Math.cos(p.anisotropyRotation),p.anisotropy*Math.sin(p.anisotropyRotation)),p.anisotropyMap&&(m.anisotropyMap.value=p.anisotropyMap,t(p.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=p.specularIntensity,m.specularColor.value.copy(p.specularColor),p.specularColorMap&&(m.specularColorMap.value=p.specularColorMap,t(p.specularColorMap,m.specularColorMapTransform)),p.specularIntensityMap&&(m.specularIntensityMap.value=p.specularIntensityMap,t(p.specularIntensityMap,m.specularIntensityMapTransform))}function g(m,p){p.matcap&&(m.matcap.value=p.matcap)}function _(m,p){let x=e.get(p).light;m.referencePosition.value.setFromMatrixPosition(x.matrixWorld),m.nearDistance.value=x.shadow.camera.near,m.farDistance.value=x.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:s}}function Vy(i,e,t,n){let s={},r={},a=[],o=i.getParameter(i.MAX_UNIFORM_BUFFER_BINDINGS);function c(x,y){let w=y.program;n.uniformBlockBinding(x,w)}function l(x,y){let w=s[x.id];w===void 0&&(g(x),w=h(x),s[x.id]=w,x.addEventListener("dispose",m));let A=y.program;n.updateUBOMapping(x,A);let S=e.render.frame;r[x.id]!==S&&(d(x),r[x.id]=S)}function h(x){let y=u();x.__bindingPointIndex=y;let w=i.createBuffer(),A=x.__size,S=x.usage;return i.bindBuffer(i.UNIFORM_BUFFER,w),i.bufferData(i.UNIFORM_BUFFER,A,S),i.bindBuffer(i.UNIFORM_BUFFER,null),i.bindBufferBase(i.UNIFORM_BUFFER,y,w),w}function u(){for(let x=0;x<o;x++)if(a.indexOf(x)===-1)return a.push(x),x;return Te("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function d(x){let y=s[x.id],w=x.uniforms,A=x.__cache;i.bindBuffer(i.UNIFORM_BUFFER,y);for(let S=0,R=w.length;S<R;S++){let b=Array.isArray(w[S])?w[S]:[w[S]];for(let T=0,P=b.length;T<P;T++){let C=b[T];if(f(C,S,T,A)===!0){let N=C.__offset,G=Array.isArray(C.value)?C.value:[C.value],q=0;for(let F=0;F<G.length;F++){let H=G[F],V=_(H);typeof H=="number"||typeof H=="boolean"?(C.__data[0]=H,i.bufferSubData(i.UNIFORM_BUFFER,N+q,C.__data)):H.isMatrix3?(C.__data[0]=H.elements[0],C.__data[1]=H.elements[1],C.__data[2]=H.elements[2],C.__data[3]=0,C.__data[4]=H.elements[3],C.__data[5]=H.elements[4],C.__data[6]=H.elements[5],C.__data[7]=0,C.__data[8]=H.elements[6],C.__data[9]=H.elements[7],C.__data[10]=H.elements[8],C.__data[11]=0):ArrayBuffer.isView(H)?C.__data.set(new H.constructor(H.buffer,H.byteOffset,C.__data.length)):(H.toArray(C.__data,q),q+=V.storage/Float32Array.BYTES_PER_ELEMENT)}i.bufferSubData(i.UNIFORM_BUFFER,N,C.__data)}}}i.bindBuffer(i.UNIFORM_BUFFER,null)}function f(x,y,w,A){let S=x.value,R=y+"_"+w;if(A[R]===void 0)return typeof S=="number"||typeof S=="boolean"?A[R]=S:ArrayBuffer.isView(S)?A[R]=S.slice():A[R]=S.clone(),!0;{let b=A[R];if(typeof S=="number"||typeof S=="boolean"){if(b!==S)return A[R]=S,!0}else{if(ArrayBuffer.isView(S))return!0;if(b.equals(S)===!1)return b.copy(S),!0}}return!1}function g(x){let y=x.uniforms,w=0,A=16;for(let R=0,b=y.length;R<b;R++){let T=Array.isArray(y[R])?y[R]:[y[R]];for(let P=0,C=T.length;P<C;P++){let N=T[P],G=Array.isArray(N.value)?N.value:[N.value];for(let q=0,F=G.length;q<F;q++){let H=G[q],V=_(H),Z=w%A,Q=Z%V.boundary,le=Z+Q;w+=Q,le!==0&&A-le<V.storage&&(w+=A-le),N.__data=new Float32Array(V.storage/Float32Array.BYTES_PER_ELEMENT),N.__offset=w,w+=V.storage}}}let S=w%A;return S>0&&(w+=A-S),x.__size=w,x.__cache={},this}function _(x){let y={boundary:0,storage:0};return typeof x=="number"||typeof x=="boolean"?(y.boundary=4,y.storage=4):x.isVector2?(y.boundary=8,y.storage=8):x.isVector3||x.isColor?(y.boundary=16,y.storage=12):x.isVector4?(y.boundary=16,y.storage=16):x.isMatrix3?(y.boundary=48,y.storage=48):x.isMatrix4?(y.boundary=64,y.storage=64):x.isTexture?ye("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(x)?(y.boundary=16,y.storage=x.byteLength):ye("WebGLRenderer: Unsupported uniform value type.",x),y}function m(x){let y=x.target;y.removeEventListener("dispose",m);let w=a.indexOf(y.__bindingPointIndex);a.splice(w,1),i.deleteBuffer(s[y.id]),delete s[y.id],delete r[y.id]}function p(){for(let x in s)i.deleteBuffer(s[x]);a=[],s={},r={}}return{bind:c,update:l,dispose:p}}function Wy(){return ei===null&&(ei=new Qs(Gy,16,16,Hi,Qn),ei.name="DFG_LUT",ei.minFilter=wt,ei.magFilter=wt,ei.wrapS=wn,ei.wrapT=wn,ei.generateMipmaps=!1,ei.needsUpdate=!0),ei}var r_,a_,o_,c_,l_,h_,u_,d_,f_,p_,m_,g_,__,b_,x_,v_,y_,w_,M_,S_,A_,E_,T_,R_,C_,L_,P_,I_,k_,D_,F_,N_,U_,O_,B_,H_,z_,V_,G_,W_,q_,X_,j_,Y_,K_,J_,$_,Z_,Q_,eb,tb,nb,ib,sb,rb,ab,ob,cb,lb,hb,ub,db,fb,pb,mb,gb,_b,bb,xb,vb,yb,wb,Mb,Sb,Ab,Eb,Tb,Rb,Cb,Lb,Pb,Ib,kb,Db,Fb,Nb,Ub,Ob,Bb,Hb,zb,Vb,Gb,Wb,qb,Xb,jb,Yb,Kb,Jb,$b,Zb,Qb,ex,tx,nx,ix,sx,rx,ax,ox,cx,lx,hx,ux,dx,fx,px,mx,gx,_x,bx,xx,vx,yx,wx,Mx,Sx,Ax,Ex,Tx,Rx,Cx,Lx,Px,Ix,kx,Dx,Fx,Nx,Ux,Ox,Be,ce,ti,Tc,Bx,cp,Vi,Bf,gs,qx,pa,Hf,Fh,Nh,Uh,Oh,Xx,Cc,Lc,iv,lp,zh,hp,up,dp,Wf,qf,Xf,jf,Yf,Vh,Gh,Wh,Bh,dr,Xv,jv,$f,$v,Rc,iy,sy,ay,cy,hy,dy,py,by,Xh,jh,Ey,Ly,Py,Iy,ky,ap,ma,Hh,Oy,By,Yh,Kh,Hy,fp,Gy,ei,_s,lt=ct(()=>{Dh();Dh();r_=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,a_=`#ifdef USE_ALPHAHASH
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
#endif`,o_=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,c_=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,l_=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,h_=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,u_=`#ifdef USE_AOMAP
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
#endif`,d_=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,f_=`#ifdef USE_BATCHING
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
#endif`,p_=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,m_=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,g_=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,__=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,b_=`#ifdef USE_IRIDESCENCE
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
#endif`,x_=`#ifdef USE_BUMPMAP
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
#endif`,v_=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,y_=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,w_=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,M_=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,S_=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,A_=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,E_=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,T_=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
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
#endif`,R_=`#define PI 3.141592653589793
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
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
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
} // validated`,C_=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,L_=`vec3 transformedNormal = objectNormal;
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
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,P_=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,I_=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,k_=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,D_=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,F_="gl_FragColor = linearToOutputTexel( gl_FragColor );",N_=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,U_=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
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
#endif`,O_=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,B_=`#ifdef USE_ENVMAP
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
#endif`,H_=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,z_=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,V_=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,G_=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,W_=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,q_=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,X_=`#ifdef USE_GRADIENTMAP
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
}`,j_=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Y_=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,K_=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,J_=`uniform bool receiveShadow;
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
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
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
#include <lightprobes_pars_fragment>`,$_=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,Z_=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Q_=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,eb=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,tb=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,nb=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
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
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
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
#endif`,ib=`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
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
		vec3 iridescenceF0;
		vec3 iridescenceFresnelDielectric;
		vec3 iridescenceFresnelMetallic;
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
		float roughness = material.clearcoatRoughness;
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
	float roughness = material.roughness;
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
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
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
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
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
vec3 BRDF_GGX_Multiscatter( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 singleScatter = BRDF_GGX( lightDir, viewDir, normal, material );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 dfgV = texture2D( dfgLUT, vec2( material.roughness, dotNV ) ).rg;
	vec2 dfgL = texture2D( dfgLUT, vec2( material.roughness, dotNL ) ).rg;
	vec3 FssEss_V = material.specularColorBlended * dfgV.x + material.specularF90 * dfgV.y;
	vec3 FssEss_L = material.specularColorBlended * dfgL.x + material.specularF90 * dfgL.y;
	float Ess_V = dfgV.x + dfgV.y;
	float Ess_L = dfgL.x + dfgL.y;
	float Ems_V = 1.0 - Ess_V;
	float Ems_L = 1.0 - Ess_L;
	vec3 Favg = material.specularColorBlended + ( 1.0 - material.specularColorBlended ) * 0.047619;
	vec3 Fms = FssEss_V * FssEss_L * Favg / ( 1.0 - Ems_V * Ems_L * Favg + EPSILON );
	float compensationFactor = Ems_V * Ems_L;
	vec3 multiScatter = Fms * compensationFactor;
	return singleScatter + multiScatter;
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
	reflectedLight.directSpecular += irradiance * BRDF_GGX_Multiscatter( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution );
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
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
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnelDielectric, material.roughness, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceFresnelMetallic, material.roughness, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.roughness, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
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
}`,sb=`
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
		material.iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( material.iridescenceFresnelDielectric, material.iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
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
	#ifdef USE_LIGHT_PROBES_GRID
		vec3 probeWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 probeWorldNormal = inverseTransformDirection( geometryNormal, viewMatrix );
		irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,rb=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,ab=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,ob=`#ifdef USE_LIGHT_PROBES_GRID
uniform highp sampler3D probesSH;
uniform vec3 probesMin;
uniform vec3 probesMax;
uniform vec3 probesResolution;
vec3 getLightProbeGridIrradiance( vec3 worldPos, vec3 worldNormal ) {
	vec3 res = probesResolution;
	vec3 gridRange = probesMax - probesMin;
	vec3 resMinusOne = res - 1.0;
	vec3 probeSpacing = gridRange / resMinusOne;
	vec3 samplePos = worldPos + worldNormal * probeSpacing * 0.5;
	vec3 uvw = clamp( ( samplePos - probesMin ) / gridRange, 0.0, 1.0 );
	uvw = uvw * resMinusOne / res + 0.5 / res;
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
#endif`,cb=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,lb=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,hb=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,ub=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,db=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,fb=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,pb=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,mb=`#if defined( USE_POINTS_UV )
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
#endif`,gb=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,_b=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,bb=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,xb=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,vb=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,yb=`#ifdef USE_MORPHTARGETS
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
#endif`,wb=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Mb=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
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
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,Sb=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
#endif`,Ab=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Eb=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Tb=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,Rb=`#ifdef USE_NORMALMAP
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
#endif`,Cb=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,Lb=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,Pb=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,Ib=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,kb=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,Db=`vec3 packNormalToRGB( const in vec3 normal ) {
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
}`,Fb=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,Nb=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,Ub=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,Ob=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,Bb=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,Hb=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,zb=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
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
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				float radius = shadowRadius * texelSize.x;
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
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float dp = ( shadowCameraNear * ( shadowCameraFar - viewSpaceZ ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp -= shadowBias;
			#else
				float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp += shadowBias;
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			vec2 sample0 = vogelDiskSample( 0, 5, phi );
			vec2 sample1 = vogelDiskSample( 1, 5, phi );
			vec2 sample2 = vogelDiskSample( 2, 5, phi );
			vec2 sample3 = vogelDiskSample( 3, 5, phi );
			vec2 sample4 = vogelDiskSample( 4, 5, phi );
			shadow = (
				texture( shadowMap, vec4( bd3D + ( tangent * sample0.x + bitangent * sample0.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample1.x + bitangent * sample1.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample2.x + bitangent * sample2.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample3.x + bitangent * sample3.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample4.x + bitangent * sample4.y ) * texelSize, dp ) )
			) * 0.2;
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
#endif`,Vb=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
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
#endif`,Gb=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
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
#endif`,Wb=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
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
}`,qb=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,Xb=`#ifdef USE_SKINNING
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
#endif`,jb=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,Yb=`#ifdef USE_SKINNING
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
#endif`,Kb=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,Jb=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,$b=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Zb=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,Qb=`#ifdef USE_TRANSMISSION
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
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,ex=`#ifdef USE_TRANSMISSION
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
#endif`,tx=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,nx=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,ix=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,sx=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,rx=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,ax=`uniform sampler2D t2D;
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
}`,ox=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,cx=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vWorldDirection );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,lx=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,hx=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,ux=`#include <common>
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
}`,dx=`#if DEPTH_PACKING == 3200
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
}`,fx=`#define DISTANCE
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
}`,px=`#define DISTANCE
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
void main () {
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
}`,mx=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,gx=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,_x=`uniform float scale;
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
}`,bx=`uniform vec3 diffuse;
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
}`,xx=`#include <common>
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
}`,vx=`uniform vec3 diffuse;
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
}`,yx=`#define LAMBERT
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
}`,wx=`#define LAMBERT
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
#include <cube_uv_reflection_fragment>
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
}`,Mx=`#define MATCAP
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
}`,Sx=`#define MATCAP
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
}`,Ax=`#define NORMAL
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
}`,Ex=`#define NORMAL
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
}`,Tx=`#define PHONG
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
}`,Rx=`#define PHONG
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
#include <cube_uv_reflection_fragment>
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
}`,Cx=`#define STANDARD
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
}`,Lx=`#define STANDARD
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
#ifdef USE_DISPERSION
	uniform float dispersion;
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
#include <cube_uv_reflection_fragment>
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
}`,Px=`#define TOON
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
}`,Ix=`#define TOON
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
}`,kx=`uniform float size;
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
}`,Dx=`uniform vec3 diffuse;
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
}`,Fx=`#include <common>
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
}`,Nx=`uniform vec3 color;
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
}`,Ux=`uniform float rotation;
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
}`,Ox=`uniform vec3 diffuse;
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
}`,Be={alphahash_fragment:r_,alphahash_pars_fragment:a_,alphamap_fragment:o_,alphamap_pars_fragment:c_,alphatest_fragment:l_,alphatest_pars_fragment:h_,aomap_fragment:u_,aomap_pars_fragment:d_,batching_pars_vertex:f_,batching_vertex:p_,begin_vertex:m_,beginnormal_vertex:g_,bsdfs:__,iridescence_fragment:b_,bumpmap_pars_fragment:x_,clipping_planes_fragment:v_,clipping_planes_pars_fragment:y_,clipping_planes_pars_vertex:w_,clipping_planes_vertex:M_,color_fragment:S_,color_pars_fragment:A_,color_pars_vertex:E_,color_vertex:T_,common:R_,cube_uv_reflection_fragment:C_,defaultnormal_vertex:L_,displacementmap_pars_vertex:P_,displacementmap_vertex:I_,emissivemap_fragment:k_,emissivemap_pars_fragment:D_,colorspace_fragment:F_,colorspace_pars_fragment:N_,envmap_fragment:U_,envmap_common_pars_fragment:O_,envmap_pars_fragment:B_,envmap_pars_vertex:H_,envmap_physical_pars_fragment:$_,envmap_vertex:z_,fog_vertex:V_,fog_pars_vertex:G_,fog_fragment:W_,fog_pars_fragment:q_,gradientmap_pars_fragment:X_,lightmap_pars_fragment:j_,lights_lambert_fragment:Y_,lights_lambert_pars_fragment:K_,lights_pars_begin:J_,lights_toon_fragment:Z_,lights_toon_pars_fragment:Q_,lights_phong_fragment:eb,lights_phong_pars_fragment:tb,lights_physical_fragment:nb,lights_physical_pars_fragment:ib,lights_fragment_begin:sb,lights_fragment_maps:rb,lights_fragment_end:ab,lightprobes_pars_fragment:ob,logdepthbuf_fragment:cb,logdepthbuf_pars_fragment:lb,logdepthbuf_pars_vertex:hb,logdepthbuf_vertex:ub,map_fragment:db,map_pars_fragment:fb,map_particle_fragment:pb,map_particle_pars_fragment:mb,metalnessmap_fragment:gb,metalnessmap_pars_fragment:_b,morphinstance_vertex:bb,morphcolor_vertex:xb,morphnormal_vertex:vb,morphtarget_pars_vertex:yb,morphtarget_vertex:wb,normal_fragment_begin:Mb,normal_fragment_maps:Sb,normal_pars_fragment:Ab,normal_pars_vertex:Eb,normal_vertex:Tb,normalmap_pars_fragment:Rb,clearcoat_normal_fragment_begin:Cb,clearcoat_normal_fragment_maps:Lb,clearcoat_pars_fragment:Pb,iridescence_pars_fragment:Ib,opaque_fragment:kb,packing:Db,premultiplied_alpha_fragment:Fb,project_vertex:Nb,dithering_fragment:Ub,dithering_pars_fragment:Ob,roughnessmap_fragment:Bb,roughnessmap_pars_fragment:Hb,shadowmap_pars_fragment:zb,shadowmap_pars_vertex:Vb,shadowmap_vertex:Gb,shadowmask_pars_fragment:Wb,skinbase_vertex:qb,skinning_pars_vertex:Xb,skinning_vertex:jb,skinnormal_vertex:Yb,specularmap_fragment:Kb,specularmap_pars_fragment:Jb,tonemapping_fragment:$b,tonemapping_pars_fragment:Zb,transmission_fragment:Qb,transmission_pars_fragment:ex,uv_pars_fragment:tx,uv_pars_vertex:nx,uv_vertex:ix,worldpos_vertex:sx,background_vert:rx,background_frag:ax,backgroundCube_vert:ox,backgroundCube_frag:cx,cube_vert:lx,cube_frag:hx,depth_vert:ux,depth_frag:dx,distance_vert:fx,distance_frag:px,equirect_vert:mx,equirect_frag:gx,linedashed_vert:_x,linedashed_frag:bx,meshbasic_vert:xx,meshbasic_frag:vx,meshlambert_vert:yx,meshlambert_frag:wx,meshmatcap_vert:Mx,meshmatcap_frag:Sx,meshnormal_vert:Ax,meshnormal_frag:Ex,meshphong_vert:Tx,meshphong_frag:Rx,meshphysical_vert:Cx,meshphysical_frag:Lx,meshtoon_vert:Px,meshtoon_frag:Ix,points_vert:kx,points_frag:Dx,shadow_vert:Fx,shadow_frag:Nx,sprite_vert:Ux,sprite_frag:Ox},ce={common:{diffuse:{value:new Ee(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new ke},alphaMap:{value:null},alphaMapTransform:{value:new ke},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new ke}},envmap:{envMap:{value:null},envMapRotation:{value:new ke},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new ke}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new ke}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new ke},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new ke},normalScale:{value:new Ie(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new ke},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new ke}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new ke}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new ke}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Ee(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new L},probesMax:{value:new L},probesResolution:{value:new L}},points:{diffuse:{value:new Ee(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new ke},alphaTest:{value:0},uvTransform:{value:new ke}},sprite:{diffuse:{value:new Ee(16777215)},opacity:{value:1},center:{value:new Ie(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new ke},alphaMap:{value:null},alphaMapTransform:{value:new ke},alphaTest:{value:0}}},ti={basic:{uniforms:jt([ce.common,ce.specularmap,ce.envmap,ce.aomap,ce.lightmap,ce.fog]),vertexShader:Be.meshbasic_vert,fragmentShader:Be.meshbasic_frag},lambert:{uniforms:jt([ce.common,ce.specularmap,ce.envmap,ce.aomap,ce.lightmap,ce.emissivemap,ce.bumpmap,ce.normalmap,ce.displacementmap,ce.fog,ce.lights,{emissive:{value:new Ee(0)},envMapIntensity:{value:1}}]),vertexShader:Be.meshlambert_vert,fragmentShader:Be.meshlambert_frag},phong:{uniforms:jt([ce.common,ce.specularmap,ce.envmap,ce.aomap,ce.lightmap,ce.emissivemap,ce.bumpmap,ce.normalmap,ce.displacementmap,ce.fog,ce.lights,{emissive:{value:new Ee(0)},specular:{value:new Ee(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:Be.meshphong_vert,fragmentShader:Be.meshphong_frag},standard:{uniforms:jt([ce.common,ce.envmap,ce.aomap,ce.lightmap,ce.emissivemap,ce.bumpmap,ce.normalmap,ce.displacementmap,ce.roughnessmap,ce.metalnessmap,ce.fog,ce.lights,{emissive:{value:new Ee(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Be.meshphysical_vert,fragmentShader:Be.meshphysical_frag},toon:{uniforms:jt([ce.common,ce.aomap,ce.lightmap,ce.emissivemap,ce.bumpmap,ce.normalmap,ce.displacementmap,ce.gradientmap,ce.fog,ce.lights,{emissive:{value:new Ee(0)}}]),vertexShader:Be.meshtoon_vert,fragmentShader:Be.meshtoon_frag},matcap:{uniforms:jt([ce.common,ce.bumpmap,ce.normalmap,ce.displacementmap,ce.fog,{matcap:{value:null}}]),vertexShader:Be.meshmatcap_vert,fragmentShader:Be.meshmatcap_frag},points:{uniforms:jt([ce.points,ce.fog]),vertexShader:Be.points_vert,fragmentShader:Be.points_frag},dashed:{uniforms:jt([ce.common,ce.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Be.linedashed_vert,fragmentShader:Be.linedashed_frag},depth:{uniforms:jt([ce.common,ce.displacementmap]),vertexShader:Be.depth_vert,fragmentShader:Be.depth_frag},normal:{uniforms:jt([ce.common,ce.bumpmap,ce.normalmap,ce.displacementmap,{opacity:{value:1}}]),vertexShader:Be.meshnormal_vert,fragmentShader:Be.meshnormal_frag},sprite:{uniforms:jt([ce.sprite,ce.fog]),vertexShader:Be.sprite_vert,fragmentShader:Be.sprite_frag},background:{uniforms:{uvTransform:{value:new ke},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Be.background_vert,fragmentShader:Be.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new ke}},vertexShader:Be.backgroundCube_vert,fragmentShader:Be.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Be.cube_vert,fragmentShader:Be.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Be.equirect_vert,fragmentShader:Be.equirect_frag},distance:{uniforms:jt([ce.common,ce.displacementmap,{referencePosition:{value:new L},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Be.distance_vert,fragmentShader:Be.distance_frag},shadow:{uniforms:jt([ce.lights,ce.fog,{color:{value:new Ee(0)},opacity:{value:1}}]),vertexShader:Be.shadow_vert,fragmentShader:Be.shadow_frag}};ti.physical={uniforms:jt([ti.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new ke},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new ke},clearcoatNormalScale:{value:new Ie(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new ke},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new ke},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new ke},sheen:{value:0},sheenColor:{value:new Ee(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new ke},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new ke},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new ke},transmissionSamplerSize:{value:new Ie},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new ke},attenuationDistance:{value:0},attenuationColor:{value:new Ee(0)},specularColor:{value:new Ee(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new ke},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new ke},anisotropyVector:{value:new Ie},anisotropyMap:{value:null},anisotropyMapTransform:{value:new ke}}]),vertexShader:Be.meshphysical_vert,fragmentShader:Be.meshphysical_frag};Tc={r:0,b:0,g:0},Bx=new Le,cp=new ke;cp.set(-1,0,0,0,1,0,0,0,1);Vi=4,Bf=[.125,.215,.35,.446,.526,.582],gs=20,qx=256,pa=new Nn,Hf=new Ee,Fh=null,Nh=0,Uh=0,Oh=!1,Xx=new L,Cc=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,t=0,n=.1,s=100,r={}){let{size:a=256,position:o=Xx}=r;Fh=this._renderer.getRenderTarget(),Nh=this._renderer.getActiveCubeFace(),Uh=this._renderer.getActiveMipmapLevel(),Oh=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(a);let c=this._allocateTargets();return c.depthBuffer=!0,this._sceneToCubeUV(e,n,s,c,o),t>0&&this._blur(c,0,0,t),this._applyPMREM(c),this._cleanup(c),c}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Gf(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Vf(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(Fh,Nh,Uh),this._renderer.xr.enabled=Oh,e.scissorTest=!1,ur(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===Oi||e.mapping===ds?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),Fh=this._renderer.getRenderTarget(),Nh=this._renderer.getActiveCubeFace(),Uh=this._renderer.getActiveMipmapLevel(),Oh=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:wt,minFilter:wt,generateMipmaps:!1,type:Qn,format:gn,colorSpace:Jt,depthBuffer:!1},s=zf(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=zf(e,t,n);let{_lodMax:r}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=jx(r)),this._blurMaterial=Kx(r,e,t),this._ggxMaterial=Yx(r,e,t)}return s}_compileMaterial(e){let t=new It(new Xt,e);this._renderer.compile(t,pa)}_sceneToCubeUV(e,t,n,s,r){let c=new At(90,1,t,n),l=[1,-1,1,1,1,1],h=[1,1,1,-1,-1,-1],u=this._renderer,d=u.autoClear,f=u.toneMapping;u.getClearColor(Hf),u.toneMapping=Un,u.autoClear=!1,u.state.buffers.depth.getReversed()&&(u.setRenderTarget(s),u.clearDepth(),u.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new It(new ir,new fn({name:"PMREM.Background",side:Zt,depthWrite:!1,depthTest:!1})));let _=this._backgroundBox,m=_.material,p=!1,x=e.background;x?x.isColor&&(m.color.copy(x),e.background=null,p=!0):(m.color.copy(Hf),p=!0);for(let y=0;y<6;y++){let w=y%3;w===0?(c.up.set(0,l[y],0),c.position.set(r.x,r.y,r.z),c.lookAt(r.x+h[y],r.y,r.z)):w===1?(c.up.set(0,0,l[y]),c.position.set(r.x,r.y,r.z),c.lookAt(r.x,r.y+h[y],r.z)):(c.up.set(0,l[y],0),c.position.set(r.x,r.y,r.z),c.lookAt(r.x,r.y,r.z+h[y]));let A=this._cubeSize;ur(s,w*A,y>2?A:0,A,A),u.setRenderTarget(s),p&&u.render(_,c),u.render(e,c)}u.toneMapping=f,u.autoClear=d,e.background=x}_textureToCubeUV(e,t){let n=this._renderer,s=e.mapping===Oi||e.mapping===ds;s?(this._cubemapMaterial===null&&(this._cubemapMaterial=Gf()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Vf());let r=s?this._cubemapMaterial:this._equirectMaterial,a=this._lodMeshes[0];a.material=r;let o=r.uniforms;o.envMap.value=e;let c=this._cubeSize;ur(t,0,0,3*c,2*c),n.setRenderTarget(t),n.render(a,pa)}_applyPMREM(e){let t=this._renderer,n=t.autoClear;t.autoClear=!1;let s=this._lodMeshes.length;for(let r=1;r<s;r++)this._applyGGXFilter(e,r-1,r);t.autoClear=n}_applyGGXFilter(e,t,n){let s=this._renderer,r=this._pingPongRenderTarget,a=this._ggxMaterial,o=this._lodMeshes[n];o.material=a;let c=a.uniforms,l=n/(this._lodMeshes.length-1),h=t/(this._lodMeshes.length-1),u=Math.sqrt(l*l-h*h),d=0+l*1.25,f=u*d,{_lodMax:g}=this,_=this._sizeLods[n],m=3*_*(n>g-Vi?n-g+Vi:0),p=4*(this._cubeSize-_);c.envMap.value=e.texture,c.roughness.value=f,c.mipInt.value=g-t,ur(r,m,p,3*_,2*_),s.setRenderTarget(r),s.render(o,pa),c.envMap.value=r.texture,c.roughness.value=0,c.mipInt.value=g-n,ur(e,m,p,3*_,2*_),s.setRenderTarget(e),s.render(o,pa)}_blur(e,t,n,s,r){let a=this._pingPongRenderTarget;this._halfBlur(e,a,t,n,s,"latitudinal",r),this._halfBlur(a,e,n,n,s,"longitudinal",r)}_halfBlur(e,t,n,s,r,a,o){let c=this._renderer,l=this._blurMaterial;a!=="latitudinal"&&a!=="longitudinal"&&Te("blur direction must be either latitudinal or longitudinal!");let h=3,u=this._lodMeshes[s];u.material=l;let d=l.uniforms,f=this._sizeLods[n]-1,g=isFinite(r)?Math.PI/(2*f):2*Math.PI/(2*gs-1),_=r/g,m=isFinite(r)?1+Math.floor(h*_):gs;m>gs&&ye(`sigmaRadians, ${r}, is too large and will clip, as it requested ${m} samples when the maximum is set to ${gs}`);let p=[],x=0;for(let R=0;R<gs;++R){let b=R/_,T=Math.exp(-b*b/2);p.push(T),R===0?x+=T:R<m&&(x+=2*T)}for(let R=0;R<p.length;R++)p[R]=p[R]/x;d.envMap.value=e.texture,d.samples.value=m,d.weights.value=p,d.latitudinal.value=a==="latitudinal",o&&(d.poleAxis.value=o);let{_lodMax:y}=this;d.dTheta.value=g,d.mipInt.value=y-n;let w=this._sizeLods[s],A=3*w*(s>y-Vi?s-y+Vi:0),S=4*(this._cubeSize-w);ur(t,A,S,3*w,2*w),c.setRenderTarget(t),c.render(u,pa)}};Lc=class extends dn{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let n={width:e,height:e,depth:1},s=[n,n,n,n,n,n];this.texture=new qr(s),this._setTextureOptions(t),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},s=new ir(5,5,5),r=new pn({name:"CubemapFromEquirect",uniforms:ms(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Zt,blending:Zn});r.uniforms.tEquirect.value=t;let a=new It(s,r),o=t.minFilter;return t.minFilter===On&&(t.minFilter=wt),new Io(1,10,this).update(e,a),t.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(e,t=!0,n=!0,s=!0){let r=e.getRenderTarget();for(let a=0;a<6;a++)e.setRenderTarget(this,a),e.clear(t,n,s);e.setRenderTarget(r)}};iv={[oh]:"LINEAR_TONE_MAPPING",[ch]:"REINHARD_TONE_MAPPING",[lh]:"CINEON_TONE_MAPPING",[hh]:"ACES_FILMIC_TONE_MAPPING",[dh]:"AGX_TONE_MAPPING",[fh]:"NEUTRAL_TONE_MAPPING",[uh]:"CUSTOM_TONE_MAPPING"};lp=new Ot,zh=new fi(1,1),hp=new Ur,up=new xo,dp=new qr,Wf=[],qf=[],Xf=new Float32Array(16),jf=new Float32Array(9),Yf=new Float32Array(4);Vh=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=Sv(t.type)}},Gh=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=Wv(t.type)}},Wh=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){let s=this.seq;for(let r=0,a=s.length;r!==a;++r){let o=s[r];o.setValue(e,t[o.id],n)}}},Bh=/(\w+)(\])?(\[|\.)?/g;dr=class{constructor(e,t){this.seq=[],this.map={};let n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let a=0;a<n;++a){let o=e.getActiveUniform(t,a),c=e.getUniformLocation(t,o.name);qv(o,c,this)}let s=[],r=[];for(let a of this.seq)a.type===e.SAMPLER_2D_SHADOW||a.type===e.SAMPLER_CUBE_SHADOW||a.type===e.SAMPLER_2D_ARRAY_SHADOW?s.push(a):r.push(a);s.length>0&&(this.seq=s.concat(r))}setValue(e,t,n,s){let r=this.map[t];r!==void 0&&r.setValue(e,n,s)}setOptional(e,t,n){let s=t[n];s!==void 0&&this.setValue(e,n,s)}static upload(e,t,n,s){for(let r=0,a=t.length;r!==a;++r){let o=t[r],c=n[o.id];c.needsUpdate!==!1&&o.setValue(e,c.value,s)}}static seqWithValue(e,t){let n=[];for(let s=0,r=e.length;s!==r;++s){let a=e[s];a.id in t&&n.push(a)}return n}};Xv=37297,jv=0;$f=new ke;$v={[oh]:"Linear",[ch]:"Reinhard",[lh]:"Cineon",[hh]:"ACESFilmic",[dh]:"AgX",[fh]:"Neutral",[uh]:"Custom"};Rc=new L;iy=/^[ \t]*#include +<([\w\d./]+)>/gm;sy=new Map;ay=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;cy={[sa]:"SHADOWMAP_TYPE_PCF",[ar]:"SHADOWMAP_TYPE_VSM"};hy={[Oi]:"ENVMAP_TYPE_CUBE",[ds]:"ENVMAP_TYPE_CUBE",[ra]:"ENVMAP_TYPE_CUBE_UV"};dy={[ds]:"ENVMAP_MODE_REFRACTION"};py={[ah]:"ENVMAP_BLENDING_MULTIPLY",[bf]:"ENVMAP_BLENDING_MIX",[xf]:"ENVMAP_BLENDING_ADD"};by=0,Xh=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let t=e.vertexShader,n=e.fragmentShader,s=this._getShaderStage(t),r=this._getShaderStage(n),a=this._getShaderCacheForMaterial(e);return a.has(s)===!1&&(a.add(s),s.usedTimes++),a.has(r)===!1&&(a.add(r),r.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){let t=this.shaderCache,n=t.get(e);return n===void 0&&(n=new jh(e),t.set(e,n)),n}},jh=class{constructor(e){this.id=by++,this.code=e,this.usedTimes=0}};Ey=0;Ly=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,Py=`uniform sampler2D shadow_pass;
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
}`,Iy=[new L(1,0,0),new L(-1,0,0),new L(0,1,0),new L(0,-1,0),new L(0,0,1),new L(0,0,-1)],ky=[new L(0,-1,0),new L(0,-1,0),new L(0,0,1),new L(0,0,-1),new L(0,-1,0),new L(0,-1,0)],ap=new Le,ma=new L,Hh=new L;Oy=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,By=`
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

}`,Yh=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t){if(this.texture===null){let n=new Xr(e.texture);(e.depthNear!==t.depthNear||e.depthFar!==t.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=n}}getMesh(e){if(this.texture!==null&&this.mesh===null){let t=e.cameras[0].viewport,n=new pn({vertexShader:Oy,fragmentShader:By,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new It(new Yr(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},Kh=class extends Fn{constructor(e,t){super();let n=this,s=null,r=1,a=null,o="local-floor",c=1,l=null,h=null,u=null,d=null,f=null,g=null,_=typeof XRWebGLBinding<"u",m=new Yh,p={},x=t.getContextAttributes(),y=null,w=null,A=[],S=[],R=new Ie,b=null,T=new At;T.viewport=new st;let P=new At;P.viewport=new st;let C=[T,P],N=new ko,G=null,q=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(K){let de=A[K];return de===void 0&&(de=new Ks,A[K]=de),de.getTargetRaySpace()},this.getControllerGrip=function(K){let de=A[K];return de===void 0&&(de=new Ks,A[K]=de),de.getGripSpace()},this.getHand=function(K){let de=A[K];return de===void 0&&(de=new Ks,A[K]=de),de.getHandSpace()};function F(K){let de=S.indexOf(K.inputSource);if(de===-1)return;let ie=A[de];ie!==void 0&&(ie.update(K.inputSource,K.frame,l||a),ie.dispatchEvent({type:K.type,data:K.inputSource}))}function H(){s.removeEventListener("select",F),s.removeEventListener("selectstart",F),s.removeEventListener("selectend",F),s.removeEventListener("squeeze",F),s.removeEventListener("squeezestart",F),s.removeEventListener("squeezeend",F),s.removeEventListener("end",H),s.removeEventListener("inputsourceschange",V);for(let K=0;K<A.length;K++){let de=S[K];de!==null&&(S[K]=null,A[K].disconnect(de))}G=null,q=null,m.reset();for(let K in p)delete p[K];e.setRenderTarget(y),f=null,d=null,u=null,s=null,w=null,Ue.stop(),n.isPresenting=!1,e.setPixelRatio(b),e.setSize(R.width,R.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(K){r=K,n.isPresenting===!0&&ye("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(K){o=K,n.isPresenting===!0&&ye("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return l||a},this.setReferenceSpace=function(K){l=K},this.getBaseLayer=function(){return d!==null?d:f},this.getBinding=function(){return u===null&&_&&(u=new XRWebGLBinding(s,t)),u},this.getFrame=function(){return g},this.getSession=function(){return s},this.setSession=async function(K){if(s=K,s!==null){if(y=e.getRenderTarget(),s.addEventListener("select",F),s.addEventListener("selectstart",F),s.addEventListener("selectend",F),s.addEventListener("squeeze",F),s.addEventListener("squeezestart",F),s.addEventListener("squeezeend",F),s.addEventListener("end",H),s.addEventListener("inputsourceschange",V),x.xrCompatible!==!0&&await t.makeXRCompatible(),b=e.getPixelRatio(),e.getSize(R),_&&"createProjectionLayer"in XRWebGLBinding.prototype){let ie=null,Re=null,De=null;x.depth&&(De=x.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,ie=x.stencil?Bi:jn,Re=x.stencil?lr:Bn);let Ce={colorFormat:t.RGBA8,depthFormat:De,scaleFactor:r};u=this.getBinding(),d=u.createProjectionLayer(Ce),s.updateRenderState({layers:[d]}),e.setPixelRatio(1),e.setSize(d.textureWidth,d.textureHeight,!1),w=new dn(d.textureWidth,d.textureHeight,{format:gn,type:an,depthTexture:new fi(d.textureWidth,d.textureHeight,Re,void 0,void 0,void 0,void 0,void 0,void 0,ie),stencilBuffer:x.stencil,colorSpace:e.outputColorSpace,samples:x.antialias?4:0,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1})}else{let ie={antialias:x.antialias,alpha:!0,depth:x.depth,stencil:x.stencil,framebufferScaleFactor:r};f=new XRWebGLLayer(s,t,ie),s.updateRenderState({baseLayer:f}),e.setPixelRatio(1),e.setSize(f.framebufferWidth,f.framebufferHeight,!1),w=new dn(f.framebufferWidth,f.framebufferHeight,{format:gn,type:an,colorSpace:e.outputColorSpace,stencilBuffer:x.stencil,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1})}w.isXRRenderTarget=!0,this.setFoveation(c),l=null,a=await s.requestReferenceSpace(o),Ue.setContext(s),Ue.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(s!==null)return s.environmentBlendMode},this.getDepthTexture=function(){return m.getDepthTexture()};function V(K){for(let de=0;de<K.removed.length;de++){let ie=K.removed[de],Re=S.indexOf(ie);Re>=0&&(S[Re]=null,A[Re].disconnect(ie))}for(let de=0;de<K.added.length;de++){let ie=K.added[de],Re=S.indexOf(ie);if(Re===-1){for(let Ce=0;Ce<A.length;Ce++)if(Ce>=S.length){S.push(ie),Re=Ce;break}else if(S[Ce]===null){S[Ce]=ie,Re=Ce;break}if(Re===-1)break}let De=A[Re];De&&De.connect(ie)}}let Z=new L,Q=new L;function le(K,de,ie){Z.setFromMatrixPosition(de.matrixWorld),Q.setFromMatrixPosition(ie.matrixWorld);let Re=Z.distanceTo(Q),De=de.projectionMatrix.elements,Ce=ie.projectionMatrix.elements,ft=De[14]/(De[10]-1),Xe=De[14]/(De[10]+1),et=(De[9]+1)/De[5],dt=(De[9]-1)/De[5],Ge=(De[8]-1)/De[0],Ct=(Ce[8]+1)/Ce[0],pt=ft*Ge,cn=ft*Ct,k=Re/(-Ge+Ct),Lt=k*-Ge;if(de.matrixWorld.decompose(K.position,K.quaternion,K.scale),K.translateX(Lt),K.translateZ(k),K.matrixWorld.compose(K.position,K.quaternion,K.scale),K.matrixWorldInverse.copy(K.matrixWorld).invert(),De[10]===-1)K.projectionMatrix.copy(de.projectionMatrix),K.projectionMatrixInverse.copy(de.projectionMatrixInverse);else{let je=ft+k,ht=Xe+k,oe=pt-Lt,mt=cn+(Re-Lt),E=et*Xe/ht*je,v=dt*Xe/ht*je;K.projectionMatrix.makePerspective(oe,mt,E,v,je,ht),K.projectionMatrixInverse.copy(K.projectionMatrix).invert()}}function xe(K,de){de===null?K.matrixWorld.copy(K.matrix):K.matrixWorld.multiplyMatrices(de.matrixWorld,K.matrix),K.matrixWorldInverse.copy(K.matrixWorld).invert()}this.updateCamera=function(K){if(s===null)return;let de=K.near,ie=K.far;m.texture!==null&&(m.depthNear>0&&(de=m.depthNear),m.depthFar>0&&(ie=m.depthFar)),N.near=P.near=T.near=de,N.far=P.far=T.far=ie,(G!==N.near||q!==N.far)&&(s.updateRenderState({depthNear:N.near,depthFar:N.far}),G=N.near,q=N.far),N.layers.mask=K.layers.mask|6,T.layers.mask=N.layers.mask&-5,P.layers.mask=N.layers.mask&-3;let Re=K.parent,De=N.cameras;xe(N,Re);for(let Ce=0;Ce<De.length;Ce++)xe(De[Ce],Re);De.length===2?le(N,T,P):N.projectionMatrix.copy(T.projectionMatrix),Se(K,N,Re)};function Se(K,de,ie){ie===null?K.matrix.copy(de.matrixWorld):(K.matrix.copy(ie.matrixWorld),K.matrix.invert(),K.matrix.multiply(de.matrixWorld)),K.matrix.decompose(K.position,K.quaternion,K.scale),K.updateMatrixWorld(!0),K.projectionMatrix.copy(de.projectionMatrix),K.projectionMatrixInverse.copy(de.projectionMatrixInverse),K.isPerspectiveCamera&&(K.fov=rs*2*Math.atan(1/K.projectionMatrix.elements[5]),K.zoom=1)}this.getCamera=function(){return N},this.getFoveation=function(){if(!(d===null&&f===null))return c},this.setFoveation=function(K){c=K,d!==null&&(d.fixedFoveation=K),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=K)},this.hasDepthSensing=function(){return m.texture!==null},this.getDepthSensingMesh=function(){return m.getMesh(N)},this.getCameraTexture=function(K){return p[K]};let Ye=null;function Qe(K,de){if(h=de.getViewerPose(l||a),g=de,h!==null){let ie=h.views;f!==null&&(e.setRenderTargetFramebuffer(w,f.framebuffer),e.setRenderTarget(w));let Re=!1;ie.length!==N.cameras.length&&(N.cameras.length=0,Re=!0);for(let Xe=0;Xe<ie.length;Xe++){let et=ie[Xe],dt=null;if(f!==null)dt=f.getViewport(et);else{let Ct=u.getViewSubImage(d,et);dt=Ct.viewport,Xe===0&&(e.setRenderTargetTextures(w,Ct.colorTexture,Ct.depthStencilTexture),e.setRenderTarget(w))}let Ge=C[Xe];Ge===void 0&&(Ge=new At,Ge.layers.enable(Xe),Ge.viewport=new st,C[Xe]=Ge),Ge.matrix.fromArray(et.transform.matrix),Ge.matrix.decompose(Ge.position,Ge.quaternion,Ge.scale),Ge.projectionMatrix.fromArray(et.projectionMatrix),Ge.projectionMatrixInverse.copy(Ge.projectionMatrix).invert(),Ge.viewport.set(dt.x,dt.y,dt.width,dt.height),Xe===0&&(N.matrix.copy(Ge.matrix),N.matrix.decompose(N.position,N.quaternion,N.scale)),Re===!0&&N.cameras.push(Ge)}let De=s.enabledFeatures;if(De&&De.includes("depth-sensing")&&s.depthUsage=="gpu-optimized"&&_){u=n.getBinding();let Xe=u.getDepthInformation(ie[0]);Xe&&Xe.isValid&&Xe.texture&&m.init(Xe,s.renderState)}if(De&&De.includes("camera-access")&&_){e.state.unbindTexture(),u=n.getBinding();for(let Xe=0;Xe<ie.length;Xe++){let et=ie[Xe].camera;if(et){let dt=p[et];dt||(dt=new Xr,p[et]=dt);let Ge=u.getCameraImage(et);dt.sourceTexture=Ge}}}}for(let ie=0;ie<A.length;ie++){let Re=S[ie],De=A[ie];Re!==null&&De!==void 0&&De.update(Re,de,l||a)}Ye&&Ye(K,de),de.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:de}),g=null}let Ue=new op;Ue.setAnimationLoop(Qe),this.setAnimationLoop=function(K){Ye=K},this.dispose=function(){}}},Hy=new Le,fp=new ke;fp.set(-1,0,0,0,1,0,0,0,1);Gy=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),ei=null;_s=class{constructor(e={}){let{canvas:t=Pf(),context:n=null,depth:s=!0,stencil:r=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:c=!0,preserveDrawingBuffer:l=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:u=!1,reversedDepthBuffer:d=!1,outputBufferType:f=an}=e;this.isWebGLRenderer=!0;let g;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");g=n.getContextAttributes().alpha}else g=a;let _=f,m=new Set([Xo,qo,Wo]),p=new Set([an,Bn,cr,lr,zo,Vo]),x=new Uint32Array(4),y=new Int32Array(4),w=new L,A=null,S=null,R=[],b=[],T=null;this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=Un,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let P=this,C=!1,N=null;this._outputColorSpace=Pt;let G=0,q=0,F=null,H=-1,V=null,Z=new st,Q=new st,le=null,xe=new Ee(0),Se=0,Ye=t.width,Qe=t.height,Ue=1,K=null,de=null,ie=new st(0,0,Ye,Qe),Re=new st(0,0,Ye,Qe),De=!1,Ce=new er,ft=!1,Xe=!1,et=new Le,dt=new L,Ge=new st,Ct={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},pt=!1;function cn(){return F===null?Ue:1}let k=n;function Lt(M,D){return t.getContext(M,D)}try{let M={alpha:!0,depth:s,stencil:r,antialias:o,premultipliedAlpha:c,preserveDrawingBuffer:l,powerPreference:h,failIfMajorPerformanceCaveat:u};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${"184"}`),t.addEventListener("webglcontextlost",J,!1),t.addEventListener("webglcontextrestored",we,!1),t.addEventListener("webglcontextcreationerror",Fe,!1),k===null){let D="webgl2";if(k=Lt(D,M),k===null)throw Lt(D)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(M){throw Te("WebGLRenderer: "+M.message),M}let je,ht,oe,mt,E,v,U,j,$,ee,ae,W,Y,fe,_e,se,te,Pe,Oe,Je,I,ne,X;function pe(){je=new $x(k),je.init(),I=new Uy(k,je),ht=new Gx(k,je,e,I),oe=new Fy(k,je),ht.reversedDepthBuffer&&d&&oe.buffers.depth.setReversed(!0),mt=new ev(k),E=new yy,v=new Ny(k,je,oe,E,ht,I,mt),U=new Jx(P),j=new s_(k),ne=new zx(k,j),$=new Zx(k,j,mt,ne),ee=new nv(k,$,j,ne,mt),Pe=new tv(k,ht,v),_e=new Wx(E),ae=new vy(P,U,je,ht,ne,_e),W=new zy(P,E),Y=new My,fe=new Cy(je),te=new Hx(P,U,oe,ee,g,c),se=new Dy(P,ee,ht),X=new Vy(k,mt,ht,oe),Oe=new Vx(k,je,mt),Je=new Qx(k,je,mt),mt.programs=ae.programs,P.capabilities=ht,P.extensions=je,P.properties=E,P.renderLists=Y,P.shadowMap=se,P.state=oe,P.info=mt}pe(),_!==an&&(T=new sv(_,t.width,t.height,s,r));let re=new Kh(P,k);this.xr=re,this.getContext=function(){return k},this.getContextAttributes=function(){return k.getContextAttributes()},this.forceContextLoss=function(){let M=je.get("WEBGL_lose_context");M&&M.loseContext()},this.forceContextRestore=function(){let M=je.get("WEBGL_lose_context");M&&M.restoreContext()},this.getPixelRatio=function(){return Ue},this.setPixelRatio=function(M){M!==void 0&&(Ue=M,this.setSize(Ye,Qe,!1))},this.getSize=function(M){return M.set(Ye,Qe)},this.setSize=function(M,D,z=!0){if(re.isPresenting){ye("WebGLRenderer: Can't change size while VR device is presenting.");return}Ye=M,Qe=D,t.width=Math.floor(M*Ue),t.height=Math.floor(D*Ue),z===!0&&(t.style.width=M+"px",t.style.height=D+"px"),T!==null&&T.setSize(t.width,t.height),this.setViewport(0,0,M,D)},this.getDrawingBufferSize=function(M){return M.set(Ye*Ue,Qe*Ue).floor()},this.setDrawingBufferSize=function(M,D,z){Ye=M,Qe=D,Ue=z,t.width=Math.floor(M*z),t.height=Math.floor(D*z),this.setViewport(0,0,M,D)},this.setEffects=function(M){if(_===an){Te("THREE.WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(M){for(let D=0;D<M.length;D++)if(M[D].isOutputPass===!0){ye("THREE.WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}T.setEffects(M||[])},this.getCurrentViewport=function(M){return M.copy(Z)},this.getViewport=function(M){return M.copy(ie)},this.setViewport=function(M,D,z,O){M.isVector4?ie.set(M.x,M.y,M.z,M.w):ie.set(M,D,z,O),oe.viewport(Z.copy(ie).multiplyScalar(Ue).round())},this.getScissor=function(M){return M.copy(Re)},this.setScissor=function(M,D,z,O){M.isVector4?Re.set(M.x,M.y,M.z,M.w):Re.set(M,D,z,O),oe.scissor(Q.copy(Re).multiplyScalar(Ue).round())},this.getScissorTest=function(){return De},this.setScissorTest=function(M){oe.setScissorTest(De=M)},this.setOpaqueSort=function(M){K=M},this.setTransparentSort=function(M){de=M},this.getClearColor=function(M){return M.copy(te.getClearColor())},this.setClearColor=function(){te.setClearColor(...arguments)},this.getClearAlpha=function(){return te.getClearAlpha()},this.setClearAlpha=function(){te.setClearAlpha(...arguments)},this.clear=function(M=!0,D=!0,z=!0){let O=0;if(M){let B=!1;if(F!==null){let ue=F.texture.format;B=m.has(ue)}if(B){let ue=F.texture.type,be=p.has(ue),he=te.getClearColor(),ve=te.getClearAlpha(),Me=he.r,Ne=he.g,He=he.b;be?(x[0]=Me,x[1]=Ne,x[2]=He,x[3]=ve,k.clearBufferuiv(k.COLOR,0,x)):(y[0]=Me,y[1]=Ne,y[2]=He,y[3]=ve,k.clearBufferiv(k.COLOR,0,y))}else O|=k.COLOR_BUFFER_BIT}D&&(O|=k.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),z&&(O|=k.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),O!==0&&k.clear(O)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(M){M.setRenderer(this),N=M},this.dispose=function(){t.removeEventListener("webglcontextlost",J,!1),t.removeEventListener("webglcontextrestored",we,!1),t.removeEventListener("webglcontextcreationerror",Fe,!1),te.dispose(),Y.dispose(),fe.dispose(),E.dispose(),U.dispose(),ee.dispose(),ne.dispose(),X.dispose(),ae.dispose(),re.dispose(),re.removeEventListener("sessionstart",sd),re.removeEventListener("sessionend",rd),Xi.stop()};function J(M){M.preventDefault(),Nr("WebGLRenderer: Context Lost."),C=!0}function we(){Nr("WebGLRenderer: Context Restored."),C=!1;let M=mt.autoReset,D=se.enabled,z=se.autoUpdate,O=se.needsUpdate,B=se.type;pe(),mt.autoReset=M,se.enabled=D,se.autoUpdate=z,se.needsUpdate=O,se.type=B}function Fe(M){Te("WebGLRenderer: A WebGL context could not be created. Reason: ",M.statusMessage)}function bt(M){let D=M.target;D.removeEventListener("dispose",bt),tt(D)}function tt(M){ri(M),E.remove(M)}function ri(M){let D=E.get(M).programs;D!==void 0&&(D.forEach(function(z){ae.releaseProgram(z)}),M.isShaderMaterial&&ae.releaseShaderCache(M))}this.renderBufferDirect=function(M,D,z,O,B,ue){D===null&&(D=Ct);let be=B.isMesh&&B.matrixWorld.determinant()<0,he=zg(M,D,z,O,B);oe.setMaterial(O,be);let ve=z.index,Me=1;if(O.wireframe===!0){if(ve=$.getWireframeAttribute(z),ve===void 0)return;Me=2}let Ne=z.drawRange,He=z.attributes.position,Ae=Ne.start*Me,nt=(Ne.start+Ne.count)*Me;ue!==null&&(Ae=Math.max(Ae,ue.start*Me),nt=Math.min(nt,(ue.start+ue.count)*Me)),ve!==null?(Ae=Math.max(Ae,0),nt=Math.min(nt,ve.count)):He!=null&&(Ae=Math.max(Ae,0),nt=Math.min(nt,He.count));let xt=nt-Ae;if(xt<0||xt===1/0)return;ne.setup(B,O,he,z,ve);let gt,at=Oe;if(ve!==null&&(gt=j.get(ve),at=Je,at.setIndex(gt)),B.isMesh)O.wireframe===!0?(oe.setLineWidth(O.wireframeLinewidth*cn()),at.setMode(k.LINES)):at.setMode(k.TRIANGLES);else if(B.isLine){let Gt=O.linewidth;Gt===void 0&&(Gt=1),oe.setLineWidth(Gt*cn()),B.isLineSegments?at.setMode(k.LINES):B.isLineLoop?at.setMode(k.LINE_LOOP):at.setMode(k.LINE_STRIP)}else B.isPoints?at.setMode(k.POINTS):B.isSprite&&at.setMode(k.TRIANGLES);if(B.isBatchedMesh)if(je.get("WEBGL_multi_draw"))at.renderMultiDraw(B._multiDrawStarts,B._multiDrawCounts,B._multiDrawCount);else{let Gt=B._multiDrawStarts,me=B._multiDrawCounts,ln=B._multiDrawCount,Ke=ve?j.get(ve).bytesPerElement:1,vn=E.get(O).currentProgram.getUniforms();for(let Gn=0;Gn<ln;Gn++)vn.setValue(k,"_gl_DrawID",Gn),at.render(Gt[Gn]/Ke,me[Gn])}else if(B.isInstancedMesh)at.renderInstances(Ae,xt,B.count);else if(z.isInstancedBufferGeometry){let Gt=z._maxInstanceCount!==void 0?z._maxInstanceCount:1/0,me=Math.min(z.instanceCount,Gt);at.renderInstances(Ae,xt,me)}else at.render(Ae,xt)};function Vn(M,D,z){M.transparent===!0&&M.side===rn&&M.forceSinglePass===!1?(M.side=Zt,M.needsUpdate=!0,Ra(M,D,z),M.side=Dn,M.needsUpdate=!0,Ra(M,D,z),M.side=rn):Ra(M,D,z)}this.compile=function(M,D,z=null){z===null&&(z=M),S=fe.get(z),S.init(D),b.push(S),z.traverseVisible(function(B){B.isLight&&B.layers.test(D.layers)&&(S.pushLight(B),B.castShadow&&S.pushShadow(B))}),M!==z&&M.traverseVisible(function(B){B.isLight&&B.layers.test(D.layers)&&(S.pushLight(B),B.castShadow&&S.pushShadow(B))}),S.setupLights();let O=new Set;return M.traverse(function(B){if(!(B.isMesh||B.isPoints||B.isLine||B.isSprite))return;let ue=B.material;if(ue)if(Array.isArray(ue))for(let be=0;be<ue.length;be++){let he=ue[be];Vn(he,z,B),O.add(he)}else Vn(ue,z,B),O.add(ue)}),S=b.pop(),O},this.compileAsync=function(M,D,z=null){let O=this.compile(M,D,z);return new Promise(B=>{function ue(){if(O.forEach(function(be){E.get(be).currentProgram.isReady()&&O.delete(be)}),O.size===0){B(M);return}setTimeout(ue,10)}je.get("KHR_parallel_shader_compile")!==null?ue():setTimeout(ue,10)})};let pl=null;function Bg(M){pl&&pl(M)}function sd(){Xi.stop()}function rd(){Xi.start()}let Xi=new op;Xi.setAnimationLoop(Bg),typeof self<"u"&&Xi.setContext(self),this.setAnimationLoop=function(M){pl=M,re.setAnimationLoop(M),M===null?Xi.stop():Xi.start()},re.addEventListener("sessionstart",sd),re.addEventListener("sessionend",rd),this.render=function(M,D){if(D!==void 0&&D.isCamera!==!0){Te("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(C===!0)return;N!==null&&N.renderStart(M,D);let z=re.enabled===!0&&re.isPresenting===!0,O=T!==null&&(F===null||z)&&T.begin(P,F);if(M.matrixWorldAutoUpdate===!0&&M.updateMatrixWorld(),D.parent===null&&D.matrixWorldAutoUpdate===!0&&D.updateMatrixWorld(),re.enabled===!0&&re.isPresenting===!0&&(T===null||T.isCompositing()===!1)&&(re.cameraAutoUpdate===!0&&re.updateCamera(D),D=re.getCamera()),M.isScene===!0&&M.onBeforeRender(P,M,D,F),S=fe.get(M,b.length),S.init(D),S.state.textureUnits=v.getTextureUnits(),b.push(S),et.multiplyMatrices(D.projectionMatrix,D.matrixWorldInverse),Ce.setFromProjectionMatrix(et,In,D.reversedDepth),Xe=this.localClippingEnabled,ft=_e.init(this.clippingPlanes,Xe),A=Y.get(M,R.length),A.init(),R.push(A),re.enabled===!0&&re.isPresenting===!0){let be=P.xr.getDepthSensingMesh();be!==null&&ml(be,D,-1/0,P.sortObjects)}ml(M,D,0,P.sortObjects),A.finish(),P.sortObjects===!0&&A.sort(K,de),pt=re.enabled===!1||re.isPresenting===!1||re.hasDepthSensing()===!1,pt&&te.addToRenderList(A,M),this.info.render.frame++,ft===!0&&_e.beginShadows();let B=S.state.shadowsArray;if(se.render(B,M,D),ft===!0&&_e.endShadows(),this.info.autoReset===!0&&this.info.reset(),(O&&T.hasRenderPass())===!1){let be=A.opaque,he=A.transmissive;if(S.setupLights(),D.isArrayCamera){let ve=D.cameras;if(he.length>0)for(let Me=0,Ne=ve.length;Me<Ne;Me++){let He=ve[Me];od(be,he,M,He)}pt&&te.render(M);for(let Me=0,Ne=ve.length;Me<Ne;Me++){let He=ve[Me];ad(A,M,He,He.viewport)}}else he.length>0&&od(be,he,M,D),pt&&te.render(M),ad(A,M,D)}F!==null&&q===0&&(v.updateMultisampleRenderTarget(F),v.updateRenderTargetMipmap(F)),O&&T.end(P),M.isScene===!0&&M.onAfterRender(P,M,D),ne.resetDefaultState(),H=-1,V=null,b.pop(),b.length>0?(S=b[b.length-1],v.setTextureUnits(S.state.textureUnits),ft===!0&&_e.setGlobalState(P.clippingPlanes,S.state.camera)):S=null,R.pop(),R.length>0?A=R[R.length-1]:A=null,N!==null&&N.renderEnd()};function ml(M,D,z,O){if(M.visible===!1)return;if(M.layers.test(D.layers)){if(M.isGroup)z=M.renderOrder;else if(M.isLOD)M.autoUpdate===!0&&M.update(D);else if(M.isLightProbeGrid)S.pushLightProbeGrid(M);else if(M.isLight)S.pushLight(M),M.castShadow&&S.pushShadow(M);else if(M.isSprite){if(!M.frustumCulled||Ce.intersectsSprite(M)){O&&Ge.setFromMatrixPosition(M.matrixWorld).applyMatrix4(et);let be=ee.update(M),he=M.material;he.visible&&A.push(M,be,he,z,Ge.z,null)}}else if((M.isMesh||M.isLine||M.isPoints)&&(!M.frustumCulled||Ce.intersectsObject(M))){let be=ee.update(M),he=M.material;if(O&&(M.boundingSphere!==void 0?(M.boundingSphere===null&&M.computeBoundingSphere(),Ge.copy(M.boundingSphere.center)):(be.boundingSphere===null&&be.computeBoundingSphere(),Ge.copy(be.boundingSphere.center)),Ge.applyMatrix4(M.matrixWorld).applyMatrix4(et)),Array.isArray(he)){let ve=be.groups;for(let Me=0,Ne=ve.length;Me<Ne;Me++){let He=ve[Me],Ae=he[He.materialIndex];Ae&&Ae.visible&&A.push(M,be,Ae,z,Ge.z,He)}}else he.visible&&A.push(M,be,he,z,Ge.z,null)}}let ue=M.children;for(let be=0,he=ue.length;be<he;be++)ml(ue[be],D,z,O)}function ad(M,D,z,O){let{opaque:B,transmissive:ue,transparent:be}=M;S.setupLightsView(z),ft===!0&&_e.setGlobalState(P.clippingPlanes,z),O&&oe.viewport(Z.copy(O)),B.length>0&&Ta(B,D,z),ue.length>0&&Ta(ue,D,z),be.length>0&&Ta(be,D,z),oe.buffers.depth.setTest(!0),oe.buffers.depth.setMask(!0),oe.buffers.color.setMask(!0),oe.setPolygonOffset(!1)}function od(M,D,z,O){if((z.isScene===!0?z.overrideMaterial:null)!==null)return;if(S.state.transmissionRenderTarget[O.id]===void 0){let Ae=je.has("EXT_color_buffer_half_float")||je.has("EXT_color_buffer_float");S.state.transmissionRenderTarget[O.id]=new dn(1,1,{generateMipmaps:!0,type:Ae?Qn:an,minFilter:On,samples:Math.max(4,ht.samples),stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:ze.workingColorSpace})}let ue=S.state.transmissionRenderTarget[O.id],be=O.viewport||Z;ue.setSize(be.z*P.transmissionResolutionScale,be.w*P.transmissionResolutionScale);let he=P.getRenderTarget(),ve=P.getActiveCubeFace(),Me=P.getActiveMipmapLevel();P.setRenderTarget(ue),P.getClearColor(xe),Se=P.getClearAlpha(),Se<1&&P.setClearColor(16777215,.5),P.clear(),pt&&te.render(z);let Ne=P.toneMapping;P.toneMapping=Un;let He=O.viewport;if(O.viewport!==void 0&&(O.viewport=void 0),S.setupLightsView(O),ft===!0&&_e.setGlobalState(P.clippingPlanes,O),Ta(M,z,O),v.updateMultisampleRenderTarget(ue),v.updateRenderTargetMipmap(ue),je.has("WEBGL_multisampled_render_to_texture")===!1){let Ae=!1;for(let nt=0,xt=D.length;nt<xt;nt++){let gt=D[nt],{object:at,geometry:Gt,material:me,group:ln}=gt;if(me.side===rn&&at.layers.test(O.layers)){let Ke=me.side;me.side=Zt,me.needsUpdate=!0,cd(at,z,O,Gt,me,ln),me.side=Ke,me.needsUpdate=!0,Ae=!0}}Ae===!0&&(v.updateMultisampleRenderTarget(ue),v.updateRenderTargetMipmap(ue))}P.setRenderTarget(he,ve,Me),P.setClearColor(xe,Se),He!==void 0&&(O.viewport=He),P.toneMapping=Ne}function Ta(M,D,z){let O=D.isScene===!0?D.overrideMaterial:null;for(let B=0,ue=M.length;B<ue;B++){let be=M[B],{object:he,geometry:ve,group:Me}=be,Ne=be.material;Ne.allowOverride===!0&&O!==null&&(Ne=O),he.layers.test(z.layers)&&cd(he,D,z,ve,Ne,Me)}}function cd(M,D,z,O,B,ue){M.onBeforeRender(P,D,z,O,B,ue),M.modelViewMatrix.multiplyMatrices(z.matrixWorldInverse,M.matrixWorld),M.normalMatrix.getNormalMatrix(M.modelViewMatrix),B.onBeforeRender(P,D,z,O,M,ue),B.transparent===!0&&B.side===rn&&B.forceSinglePass===!1?(B.side=Zt,B.needsUpdate=!0,P.renderBufferDirect(z,D,O,B,M,ue),B.side=Dn,B.needsUpdate=!0,P.renderBufferDirect(z,D,O,B,M,ue),B.side=rn):P.renderBufferDirect(z,D,O,B,M,ue),M.onAfterRender(P,D,z,O,B,ue)}function Ra(M,D,z){D.isScene!==!0&&(D=Ct);let O=E.get(M),B=S.state.lights,ue=S.state.shadowsArray,be=B.state.version,he=ae.getParameters(M,B.state,ue,D,z,S.state.lightProbeGridArray),ve=ae.getProgramCacheKey(he),Me=O.programs;O.environment=M.isMeshStandardMaterial||M.isMeshLambertMaterial||M.isMeshPhongMaterial?D.environment:null,O.fog=D.fog;let Ne=M.isMeshStandardMaterial||M.isMeshLambertMaterial&&!M.envMap||M.isMeshPhongMaterial&&!M.envMap;O.envMap=U.get(M.envMap||O.environment,Ne),O.envMapRotation=O.environment!==null&&M.envMap===null?D.environmentRotation:M.envMapRotation,Me===void 0&&(M.addEventListener("dispose",bt),Me=new Map,O.programs=Me);let He=Me.get(ve);if(He!==void 0){if(O.currentProgram===He&&O.lightsStateVersion===be)return hd(M,he),He}else he.uniforms=ae.getUniforms(M),N!==null&&M.isNodeMaterial&&N.build(M,z,he),M.onBeforeCompile(he,P),He=ae.acquireProgram(he,ve),Me.set(ve,He),O.uniforms=he.uniforms;let Ae=O.uniforms;return(!M.isShaderMaterial&&!M.isRawShaderMaterial||M.clipping===!0)&&(Ae.clippingPlanes=_e.uniform),hd(M,he),O.needsLights=Gg(M),O.lightsStateVersion=be,O.needsLights&&(Ae.ambientLightColor.value=B.state.ambient,Ae.lightProbe.value=B.state.probe,Ae.directionalLights.value=B.state.directional,Ae.directionalLightShadows.value=B.state.directionalShadow,Ae.spotLights.value=B.state.spot,Ae.spotLightShadows.value=B.state.spotShadow,Ae.rectAreaLights.value=B.state.rectArea,Ae.ltc_1.value=B.state.rectAreaLTC1,Ae.ltc_2.value=B.state.rectAreaLTC2,Ae.pointLights.value=B.state.point,Ae.pointLightShadows.value=B.state.pointShadow,Ae.hemisphereLights.value=B.state.hemi,Ae.directionalShadowMatrix.value=B.state.directionalShadowMatrix,Ae.spotLightMatrix.value=B.state.spotLightMatrix,Ae.spotLightMap.value=B.state.spotLightMap,Ae.pointShadowMatrix.value=B.state.pointShadowMatrix),O.lightProbeGrid=S.state.lightProbeGridArray.length>0,O.currentProgram=He,O.uniformsList=null,He}function ld(M){if(M.uniformsList===null){let D=M.currentProgram.getUniforms();M.uniformsList=dr.seqWithValue(D.seq,M.uniforms)}return M.uniformsList}function hd(M,D){let z=E.get(M);z.outputColorSpace=D.outputColorSpace,z.batching=D.batching,z.batchingColor=D.batchingColor,z.instancing=D.instancing,z.instancingColor=D.instancingColor,z.instancingMorph=D.instancingMorph,z.skinning=D.skinning,z.morphTargets=D.morphTargets,z.morphNormals=D.morphNormals,z.morphColors=D.morphColors,z.morphTargetsCount=D.morphTargetsCount,z.numClippingPlanes=D.numClippingPlanes,z.numIntersection=D.numClipIntersection,z.vertexAlphas=D.vertexAlphas,z.vertexTangents=D.vertexTangents,z.toneMapping=D.toneMapping}function Hg(M,D){if(M.length===0)return null;if(M.length===1)return M[0].texture!==null?M[0]:null;w.setFromMatrixPosition(D.matrixWorld);for(let z=0,O=M.length;z<O;z++){let B=M[z];if(B.texture!==null&&B.boundingBox.containsPoint(w))return B}return null}function zg(M,D,z,O,B){D.isScene!==!0&&(D=Ct),v.resetTextureUnits();let ue=D.fog,be=O.isMeshStandardMaterial||O.isMeshLambertMaterial||O.isMeshPhongMaterial?D.environment:null,he=F===null?P.outputColorSpace:F.isXRRenderTarget===!0?F.texture.colorSpace:ze.workingColorSpace,ve=O.isMeshStandardMaterial||O.isMeshLambertMaterial&&!O.envMap||O.isMeshPhongMaterial&&!O.envMap,Me=U.get(O.envMap||be,ve),Ne=O.vertexColors===!0&&!!z.attributes.color&&z.attributes.color.itemSize===4,He=!!z.attributes.tangent&&(!!O.normalMap||O.anisotropy>0),Ae=!!z.morphAttributes.position,nt=!!z.morphAttributes.normal,xt=!!z.morphAttributes.color,gt=Un;O.toneMapped&&(F===null||F.isXRRenderTarget===!0)&&(gt=P.toneMapping);let at=z.morphAttributes.position||z.morphAttributes.normal||z.morphAttributes.color,Gt=at!==void 0?at.length:0,me=E.get(O),ln=S.state.lights;if(ft===!0&&(Xe===!0||M!==V)){let ut=M===V&&O.id===H;_e.setState(O,M,ut)}let Ke=!1;O.version===me.__version?(me.needsLights&&me.lightsStateVersion!==ln.state.version||me.outputColorSpace!==he||B.isBatchedMesh&&me.batching===!1||!B.isBatchedMesh&&me.batching===!0||B.isBatchedMesh&&me.batchingColor===!0&&B.colorTexture===null||B.isBatchedMesh&&me.batchingColor===!1&&B.colorTexture!==null||B.isInstancedMesh&&me.instancing===!1||!B.isInstancedMesh&&me.instancing===!0||B.isSkinnedMesh&&me.skinning===!1||!B.isSkinnedMesh&&me.skinning===!0||B.isInstancedMesh&&me.instancingColor===!0&&B.instanceColor===null||B.isInstancedMesh&&me.instancingColor===!1&&B.instanceColor!==null||B.isInstancedMesh&&me.instancingMorph===!0&&B.morphTexture===null||B.isInstancedMesh&&me.instancingMorph===!1&&B.morphTexture!==null||me.envMap!==Me||O.fog===!0&&me.fog!==ue||me.numClippingPlanes!==void 0&&(me.numClippingPlanes!==_e.numPlanes||me.numIntersection!==_e.numIntersection)||me.vertexAlphas!==Ne||me.vertexTangents!==He||me.morphTargets!==Ae||me.morphNormals!==nt||me.morphColors!==xt||me.toneMapping!==gt||me.morphTargetsCount!==Gt||!!me.lightProbeGrid!=S.state.lightProbeGridArray.length>0)&&(Ke=!0):(Ke=!0,me.__version=O.version);let vn=me.currentProgram;Ke===!0&&(vn=Ra(O,D,B),N&&O.isNodeMaterial&&N.onUpdateProgram(O,vn,me));let Gn=!1,vi=!1,Ms=!1,ot=vn.getUniforms(),vt=me.uniforms;if(oe.useProgram(vn.program)&&(Gn=!0,vi=!0,Ms=!0),O.id!==H&&(H=O.id,vi=!0),me.needsLights){let ut=Hg(S.state.lightProbeGridArray,B);me.lightProbeGrid!==ut&&(me.lightProbeGrid=ut,vi=!0)}if(Gn||V!==M){oe.buffers.depth.getReversed()&&M.reversedDepth!==!0&&(M._reversedDepth=!0,M.updateProjectionMatrix()),ot.setValue(k,"projectionMatrix",M.projectionMatrix),ot.setValue(k,"viewMatrix",M.matrixWorldInverse);let wi=ot.map.cameraPosition;wi!==void 0&&wi.setValue(k,dt.setFromMatrixPosition(M.matrixWorld)),ht.logarithmicDepthBuffer&&ot.setValue(k,"logDepthBufFC",2/(Math.log(M.far+1)/Math.LN2)),(O.isMeshPhongMaterial||O.isMeshToonMaterial||O.isMeshLambertMaterial||O.isMeshBasicMaterial||O.isMeshStandardMaterial||O.isShaderMaterial)&&ot.setValue(k,"isOrthographic",M.isOrthographicCamera===!0),V!==M&&(V=M,vi=!0,Ms=!0)}if(me.needsLights&&(ln.state.directionalShadowMap.length>0&&ot.setValue(k,"directionalShadowMap",ln.state.directionalShadowMap,v),ln.state.spotShadowMap.length>0&&ot.setValue(k,"spotShadowMap",ln.state.spotShadowMap,v),ln.state.pointShadowMap.length>0&&ot.setValue(k,"pointShadowMap",ln.state.pointShadowMap,v)),B.isSkinnedMesh){ot.setOptional(k,B,"bindMatrix"),ot.setOptional(k,B,"bindMatrixInverse");let ut=B.skeleton;ut&&(ut.boneTexture===null&&ut.computeBoneTexture(),ot.setValue(k,"boneTexture",ut.boneTexture,v))}B.isBatchedMesh&&(ot.setOptional(k,B,"batchingTexture"),ot.setValue(k,"batchingTexture",B._matricesTexture,v),ot.setOptional(k,B,"batchingIdTexture"),ot.setValue(k,"batchingIdTexture",B._indirectTexture,v),ot.setOptional(k,B,"batchingColorTexture"),B._colorsTexture!==null&&ot.setValue(k,"batchingColorTexture",B._colorsTexture,v));let yi=z.morphAttributes;if((yi.position!==void 0||yi.normal!==void 0||yi.color!==void 0)&&Pe.update(B,z,vn),(vi||me.receiveShadow!==B.receiveShadow)&&(me.receiveShadow=B.receiveShadow,ot.setValue(k,"receiveShadow",B.receiveShadow)),(O.isMeshStandardMaterial||O.isMeshLambertMaterial||O.isMeshPhongMaterial)&&O.envMap===null&&D.environment!==null&&(vt.envMapIntensity.value=D.environmentIntensity),vt.dfgLUT!==void 0&&(vt.dfgLUT.value=Wy()),vi){if(ot.setValue(k,"toneMappingExposure",P.toneMappingExposure),me.needsLights&&Vg(vt,Ms),ue&&O.fog===!0&&W.refreshFogUniforms(vt,ue),W.refreshMaterialUniforms(vt,O,Ue,Qe,S.state.transmissionRenderTarget[M.id]),me.needsLights&&me.lightProbeGrid){let ut=me.lightProbeGrid;vt.probesSH.value=ut.texture,vt.probesMin.value.copy(ut.boundingBox.min),vt.probesMax.value.copy(ut.boundingBox.max),vt.probesResolution.value.copy(ut.resolution)}dr.upload(k,ld(me),vt,v)}if(O.isShaderMaterial&&O.uniformsNeedUpdate===!0&&(dr.upload(k,ld(me),vt,v),O.uniformsNeedUpdate=!1),O.isSpriteMaterial&&ot.setValue(k,"center",B.center),ot.setValue(k,"modelViewMatrix",B.modelViewMatrix),ot.setValue(k,"normalMatrix",B.normalMatrix),ot.setValue(k,"modelMatrix",B.matrixWorld),O.uniformsGroups!==void 0){let ut=O.uniformsGroups;for(let wi=0,Ss=ut.length;wi<Ss;wi++){let ud=ut[wi];X.update(ud,vn),X.bind(ud,vn)}}return vn}function Vg(M,D){M.ambientLightColor.needsUpdate=D,M.lightProbe.needsUpdate=D,M.directionalLights.needsUpdate=D,M.directionalLightShadows.needsUpdate=D,M.pointLights.needsUpdate=D,M.pointLightShadows.needsUpdate=D,M.spotLights.needsUpdate=D,M.spotLightShadows.needsUpdate=D,M.rectAreaLights.needsUpdate=D,M.hemisphereLights.needsUpdate=D}function Gg(M){return M.isMeshLambertMaterial||M.isMeshToonMaterial||M.isMeshPhongMaterial||M.isMeshStandardMaterial||M.isShadowMaterial||M.isShaderMaterial&&M.lights===!0}this.getActiveCubeFace=function(){return G},this.getActiveMipmapLevel=function(){return q},this.getRenderTarget=function(){return F},this.setRenderTargetTextures=function(M,D,z){let O=E.get(M);O.__autoAllocateDepthBuffer=M.resolveDepthBuffer===!1,O.__autoAllocateDepthBuffer===!1&&(O.__useRenderToTexture=!1),E.get(M.texture).__webglTexture=D,E.get(M.depthTexture).__webglTexture=O.__autoAllocateDepthBuffer?void 0:z,O.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(M,D){let z=E.get(M);z.__webglFramebuffer=D,z.__useDefaultFramebuffer=D===void 0};let Wg=k.createFramebuffer();this.setRenderTarget=function(M,D=0,z=0){F=M,G=D,q=z;let O=null,B=!1,ue=!1;if(M){let he=E.get(M);if(he.__useDefaultFramebuffer!==void 0){oe.bindFramebuffer(k.FRAMEBUFFER,he.__webglFramebuffer),Z.copy(M.viewport),Q.copy(M.scissor),le=M.scissorTest,oe.viewport(Z),oe.scissor(Q),oe.setScissorTest(le),H=-1;return}else if(he.__webglFramebuffer===void 0)v.setupRenderTarget(M);else if(he.__hasExternalTextures)v.rebindTextures(M,E.get(M.texture).__webglTexture,E.get(M.depthTexture).__webglTexture);else if(M.depthBuffer){let Ne=M.depthTexture;if(he.__boundDepthTexture!==Ne){if(Ne!==null&&E.has(Ne)&&(M.width!==Ne.image.width||M.height!==Ne.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");v.setupDepthRenderbuffer(M)}}let ve=M.texture;(ve.isData3DTexture||ve.isDataArrayTexture||ve.isCompressedArrayTexture)&&(ue=!0);let Me=E.get(M).__webglFramebuffer;M.isWebGLCubeRenderTarget?(Array.isArray(Me[D])?O=Me[D][z]:O=Me[D],B=!0):M.samples>0&&v.useMultisampledRTT(M)===!1?O=E.get(M).__webglMultisampledFramebuffer:Array.isArray(Me)?O=Me[z]:O=Me,Z.copy(M.viewport),Q.copy(M.scissor),le=M.scissorTest}else Z.copy(ie).multiplyScalar(Ue).floor(),Q.copy(Re).multiplyScalar(Ue).floor(),le=De;if(z!==0&&(O=Wg),oe.bindFramebuffer(k.FRAMEBUFFER,O)&&oe.drawBuffers(M,O),oe.viewport(Z),oe.scissor(Q),oe.setScissorTest(le),B){let he=E.get(M.texture);k.framebufferTexture2D(k.FRAMEBUFFER,k.COLOR_ATTACHMENT0,k.TEXTURE_CUBE_MAP_POSITIVE_X+D,he.__webglTexture,z)}else if(ue){let he=D;for(let ve=0;ve<M.textures.length;ve++){let Me=E.get(M.textures[ve]);k.framebufferTextureLayer(k.FRAMEBUFFER,k.COLOR_ATTACHMENT0+ve,Me.__webglTexture,z,he)}}else if(M!==null&&z!==0){let he=E.get(M.texture);k.framebufferTexture2D(k.FRAMEBUFFER,k.COLOR_ATTACHMENT0,k.TEXTURE_2D,he.__webglTexture,z)}H=-1},this.readRenderTargetPixels=function(M,D,z,O,B,ue,be,he=0){if(!(M&&M.isWebGLRenderTarget)){Te("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let ve=E.get(M).__webglFramebuffer;if(M.isWebGLCubeRenderTarget&&be!==void 0&&(ve=ve[be]),ve){oe.bindFramebuffer(k.FRAMEBUFFER,ve);try{let Me=M.textures[he],Ne=Me.format,He=Me.type;if(M.textures.length>1&&k.readBuffer(k.COLOR_ATTACHMENT0+he),!ht.textureFormatReadable(Ne)){Te("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!ht.textureTypeReadable(He)){Te("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}D>=0&&D<=M.width-O&&z>=0&&z<=M.height-B&&k.readPixels(D,z,O,B,I.convert(Ne),I.convert(He),ue)}finally{let Me=F!==null?E.get(F).__webglFramebuffer:null;oe.bindFramebuffer(k.FRAMEBUFFER,Me)}}},this.readRenderTargetPixelsAsync=async function(M,D,z,O,B,ue,be,he=0){if(!(M&&M.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let ve=E.get(M).__webglFramebuffer;if(M.isWebGLCubeRenderTarget&&be!==void 0&&(ve=ve[be]),ve)if(D>=0&&D<=M.width-O&&z>=0&&z<=M.height-B){oe.bindFramebuffer(k.FRAMEBUFFER,ve);let Me=M.textures[he],Ne=Me.format,He=Me.type;if(M.textures.length>1&&k.readBuffer(k.COLOR_ATTACHMENT0+he),!ht.textureFormatReadable(Ne))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!ht.textureTypeReadable(He))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let Ae=k.createBuffer();k.bindBuffer(k.PIXEL_PACK_BUFFER,Ae),k.bufferData(k.PIXEL_PACK_BUFFER,ue.byteLength,k.STREAM_READ),k.readPixels(D,z,O,B,I.convert(Ne),I.convert(He),0);let nt=F!==null?E.get(F).__webglFramebuffer:null;oe.bindFramebuffer(k.FRAMEBUFFER,nt);let xt=k.fenceSync(k.SYNC_GPU_COMMANDS_COMPLETE,0);return k.flush(),await kf(k,xt,4),k.bindBuffer(k.PIXEL_PACK_BUFFER,Ae),k.getBufferSubData(k.PIXEL_PACK_BUFFER,0,ue),k.deleteBuffer(Ae),k.deleteSync(xt),ue}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(M,D=null,z=0){let O=Math.pow(2,-z),B=Math.floor(M.image.width*O),ue=Math.floor(M.image.height*O),be=D!==null?D.x:0,he=D!==null?D.y:0;v.setTexture2D(M,0),k.copyTexSubImage2D(k.TEXTURE_2D,z,0,0,be,he,B,ue),oe.unbindTexture()};let qg=k.createFramebuffer(),Xg=k.createFramebuffer();this.copyTextureToTexture=function(M,D,z=null,O=null,B=0,ue=0){let be,he,ve,Me,Ne,He,Ae,nt,xt,gt=M.isCompressedTexture?M.mipmaps[ue]:M.image;if(z!==null)be=z.max.x-z.min.x,he=z.max.y-z.min.y,ve=z.isBox3?z.max.z-z.min.z:1,Me=z.min.x,Ne=z.min.y,He=z.isBox3?z.min.z:0;else{let vt=Math.pow(2,-B);be=Math.floor(gt.width*vt),he=Math.floor(gt.height*vt),M.isDataArrayTexture?ve=gt.depth:M.isData3DTexture?ve=Math.floor(gt.depth*vt):ve=1,Me=0,Ne=0,He=0}O!==null?(Ae=O.x,nt=O.y,xt=O.z):(Ae=0,nt=0,xt=0);let at=I.convert(D.format),Gt=I.convert(D.type),me;D.isData3DTexture?(v.setTexture3D(D,0),me=k.TEXTURE_3D):D.isDataArrayTexture||D.isCompressedArrayTexture?(v.setTexture2DArray(D,0),me=k.TEXTURE_2D_ARRAY):(v.setTexture2D(D,0),me=k.TEXTURE_2D),oe.activeTexture(k.TEXTURE0),oe.pixelStorei(k.UNPACK_FLIP_Y_WEBGL,D.flipY),oe.pixelStorei(k.UNPACK_PREMULTIPLY_ALPHA_WEBGL,D.premultiplyAlpha),oe.pixelStorei(k.UNPACK_ALIGNMENT,D.unpackAlignment);let ln=oe.getParameter(k.UNPACK_ROW_LENGTH),Ke=oe.getParameter(k.UNPACK_IMAGE_HEIGHT),vn=oe.getParameter(k.UNPACK_SKIP_PIXELS),Gn=oe.getParameter(k.UNPACK_SKIP_ROWS),vi=oe.getParameter(k.UNPACK_SKIP_IMAGES);oe.pixelStorei(k.UNPACK_ROW_LENGTH,gt.width),oe.pixelStorei(k.UNPACK_IMAGE_HEIGHT,gt.height),oe.pixelStorei(k.UNPACK_SKIP_PIXELS,Me),oe.pixelStorei(k.UNPACK_SKIP_ROWS,Ne),oe.pixelStorei(k.UNPACK_SKIP_IMAGES,He);let Ms=M.isDataArrayTexture||M.isData3DTexture,ot=D.isDataArrayTexture||D.isData3DTexture;if(M.isDepthTexture){let vt=E.get(M),yi=E.get(D),ut=E.get(vt.__renderTarget),wi=E.get(yi.__renderTarget);oe.bindFramebuffer(k.READ_FRAMEBUFFER,ut.__webglFramebuffer),oe.bindFramebuffer(k.DRAW_FRAMEBUFFER,wi.__webglFramebuffer);for(let Ss=0;Ss<ve;Ss++)Ms&&(k.framebufferTextureLayer(k.READ_FRAMEBUFFER,k.COLOR_ATTACHMENT0,E.get(M).__webglTexture,B,He+Ss),k.framebufferTextureLayer(k.DRAW_FRAMEBUFFER,k.COLOR_ATTACHMENT0,E.get(D).__webglTexture,ue,xt+Ss)),k.blitFramebuffer(Me,Ne,be,he,Ae,nt,be,he,k.DEPTH_BUFFER_BIT,k.NEAREST);oe.bindFramebuffer(k.READ_FRAMEBUFFER,null),oe.bindFramebuffer(k.DRAW_FRAMEBUFFER,null)}else if(B!==0||M.isRenderTargetTexture||E.has(M)){let vt=E.get(M),yi=E.get(D);oe.bindFramebuffer(k.READ_FRAMEBUFFER,qg),oe.bindFramebuffer(k.DRAW_FRAMEBUFFER,Xg);for(let ut=0;ut<ve;ut++)Ms?k.framebufferTextureLayer(k.READ_FRAMEBUFFER,k.COLOR_ATTACHMENT0,vt.__webglTexture,B,He+ut):k.framebufferTexture2D(k.READ_FRAMEBUFFER,k.COLOR_ATTACHMENT0,k.TEXTURE_2D,vt.__webglTexture,B),ot?k.framebufferTextureLayer(k.DRAW_FRAMEBUFFER,k.COLOR_ATTACHMENT0,yi.__webglTexture,ue,xt+ut):k.framebufferTexture2D(k.DRAW_FRAMEBUFFER,k.COLOR_ATTACHMENT0,k.TEXTURE_2D,yi.__webglTexture,ue),B!==0?k.blitFramebuffer(Me,Ne,be,he,Ae,nt,be,he,k.COLOR_BUFFER_BIT,k.NEAREST):ot?k.copyTexSubImage3D(me,ue,Ae,nt,xt+ut,Me,Ne,be,he):k.copyTexSubImage2D(me,ue,Ae,nt,Me,Ne,be,he);oe.bindFramebuffer(k.READ_FRAMEBUFFER,null),oe.bindFramebuffer(k.DRAW_FRAMEBUFFER,null)}else ot?M.isDataTexture||M.isData3DTexture?k.texSubImage3D(me,ue,Ae,nt,xt,be,he,ve,at,Gt,gt.data):D.isCompressedArrayTexture?k.compressedTexSubImage3D(me,ue,Ae,nt,xt,be,he,ve,at,gt.data):k.texSubImage3D(me,ue,Ae,nt,xt,be,he,ve,at,Gt,gt):M.isDataTexture?k.texSubImage2D(k.TEXTURE_2D,ue,Ae,nt,be,he,at,Gt,gt.data):M.isCompressedTexture?k.compressedTexSubImage2D(k.TEXTURE_2D,ue,Ae,nt,gt.width,gt.height,at,gt.data):k.texSubImage2D(k.TEXTURE_2D,ue,Ae,nt,be,he,at,Gt,gt);oe.pixelStorei(k.UNPACK_ROW_LENGTH,ln),oe.pixelStorei(k.UNPACK_IMAGE_HEIGHT,Ke),oe.pixelStorei(k.UNPACK_SKIP_PIXELS,vn),oe.pixelStorei(k.UNPACK_SKIP_ROWS,Gn),oe.pixelStorei(k.UNPACK_SKIP_IMAGES,vi),ue===0&&D.generateMipmaps&&k.generateMipmap(me),oe.unbindTexture()},this.initRenderTarget=function(M){E.get(M).__webglFramebuffer===void 0&&v.setupRenderTarget(M)},this.initTexture=function(M){M.isCubeTexture?v.setTextureCube(M,0):M.isData3DTexture?v.setTexture3D(M,0):M.isDataArrayTexture||M.isCompressedArrayTexture?v.setTexture2DArray(M,0):v.setTexture2D(M,0),oe.unbindTexture()},this.resetState=function(){G=0,q=0,F=null,oe.reset(),ne.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return In}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=ze._getDrawingBufferColorSpace(e),t.unpackColorSpace=ze._getUnpackColorSpace()}}});function kc(){if(typeof window>"u")return;let i=Number(window.__agent3dReservedContexts)||0;if(window.__agent3dReservedContexts=i+1,typeof window.__agent3dEnforceBudget=="function")try{window.__agent3dEnforceBudget()}catch{}}function Jh(){if(typeof window>"u")return;let i=Number(window.__agent3dReservedContexts)||0;window.__agent3dReservedContexts=Math.max(0,i-1)}var $h=ct(()=>{"use strict"});function pp(){if(typeof window>"u")return!1;if(window.__walkDebug)return!0;try{return window.localStorage?.getItem("walk:debug")==="1"}catch{return!1}}var Hn,Dc=ct(()=>{"use strict";Hn={debug(...i){pp()&&console.debug("[walk]",...i)},info(...i){pp()&&console.info("[walk]",...i)},warn(...i){console.warn("[walk]",...i)},error(...i){console.error("[walk]",...i)}}});function Fc(i,e){try{sessionStorage.setItem(i,e)}catch{}}function Nc(){try{return window.matchMedia("(prefers-reduced-motion: reduce)").matches}catch{return!1}}function mp(){try{return window.matchMedia("(pointer: coarse)").matches}catch{return!1}}function Uc(){try{let i=document.createElement("canvas");return!!(window.WebGLRenderingContext&&(i.getContext("webgl2")||i.getContext("webgl")))}catch{return!1}}function Vt(i,e,t){return Math.max(e,Math.min(t,i))}var Oc=ct(()=>{"use strict"});function Zh(i,e){if(e===yh)return console.warn("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles."),i;if(e===hr||e===fa){let t=i.getIndex();if(t===null){let a=[],o=i.getAttribute("position");if(o!==void 0){for(let c=0;c<o.count;c++)a.push(c);i.setIndex(a),t=i.getIndex()}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible."),i}let n=t.count-2,s=[];if(e===hr)for(let a=1;a<=n;a++)s.push(t.getX(0)),s.push(t.getX(a)),s.push(t.getX(a+1));else for(let a=0;a<n;a++)a%2===0?(s.push(t.getX(a)),s.push(t.getX(a+1)),s.push(t.getX(a+2))):(s.push(t.getX(a+2)),s.push(t.getX(a+1)),s.push(t.getX(a)));s.length/3!==n&&console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles.");let r=i.clone();return r.setIndex(s),r.clearGroups(),r}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:",e),i}var gp=ct(()=>{lt()});function _p(i){let e=new Map,t=new Map,n=i.clone();return bp(i,n,function(s,r){e.set(r,s),t.set(s,r)}),n.traverse(function(s){if(!s.isSkinnedMesh)return;let r=s,a=e.get(s),o=a.skeleton.bones;r.skeleton=a.skeleton.clone(),r.bindMatrix.copy(a.bindMatrix),r.skeleton.bones=o.map(function(c){return t.get(c)}),r.bind(r.skeleton,r.bindMatrix)}),n}function bp(i,e,t){t(i,e);for(let n=0;n<i.children.length;n++)bp(i.children[n],e.children[n],t)}var xp=ct(()=>{});var Ap={};Ca(Ap,{GLTFLoader:()=>ba});function qy(){let i={};return{get:function(e){return i[e]},add:function(e,t){i[e]=t},remove:function(e){delete i[e]},removeAll:function(){i={}}}}function Mt(i,e,t){let n=i.json.materials[e];return n.extensions&&n.extensions[t]?n.extensions[t]:null}function Yy(i){return i.DefaultMaterial===void 0&&(i.DefaultMaterial=new hs({color:16777215,emissive:0,metalness:1,roughness:1,transparent:!1,depthTest:!0,side:Dn})),i.DefaultMaterial}function bs(i,e,t){for(let n in t.extensions)i[n]===void 0&&(e.userData.gltfExtensions=e.userData.gltfExtensions||{},e.userData.gltfExtensions[n]=t.extensions[n])}function ni(i,e){e.extras!==void 0&&(typeof e.extras=="object"?Object.assign(i.userData,e.extras):console.warn("THREE.GLTFLoader: Ignoring primitive type .extras, "+e.extras))}function Ky(i,e,t){let n=!1,s=!1,r=!1;for(let l=0,h=e.length;l<h;l++){let u=e[l];if(u.POSITION!==void 0&&(n=!0),u.NORMAL!==void 0&&(s=!0),u.COLOR_0!==void 0&&(r=!0),n&&s&&r)break}if(!n&&!s&&!r)return Promise.resolve(i);let a=[],o=[],c=[];for(let l=0,h=e.length;l<h;l++){let u=e[l];if(n){let d=u.POSITION!==void 0?t.getDependency("accessor",u.POSITION):i.attributes.position;a.push(d)}if(s){let d=u.NORMAL!==void 0?t.getDependency("accessor",u.NORMAL):i.attributes.normal;o.push(d)}if(r){let d=u.COLOR_0!==void 0?t.getDependency("accessor",u.COLOR_0):i.attributes.color;c.push(d)}}return Promise.all([Promise.all(a),Promise.all(o),Promise.all(c)]).then(function(l){let h=l[0],u=l[1],d=l[2];return n&&(i.morphAttributes.position=h),s&&(i.morphAttributes.normal=u),r&&(i.morphAttributes.color=d),i.morphTargetsRelative=!0,i})}function Jy(i,e){if(i.updateMorphTargets(),e.weights!==void 0)for(let t=0,n=e.weights.length;t<n;t++)i.morphTargetInfluences[t]=e.weights[t];if(e.extras&&Array.isArray(e.extras.targetNames)){let t=e.extras.targetNames;if(i.morphTargetInfluences.length===t.length){i.morphTargetDictionary={};for(let n=0,s=t.length;n<s;n++)i.morphTargetDictionary[t[n]]=n}else console.warn("THREE.GLTFLoader: Invalid extras.targetNames length. Ignoring names.")}}function $y(i){let e,t=i.extensions&&i.extensions[Ve.KHR_DRACO_MESH_COMPRESSION];if(t?e="draco:"+t.bufferView+":"+t.indices+":"+tu(t.attributes):e=i.indices+":"+tu(i.attributes)+":"+i.mode,i.targets!==void 0)for(let n=0,s=i.targets.length;n<s;n++)e+=":"+tu(i.targets[n]);return e}function tu(i){let e="",t=Object.keys(i).sort();for(let n=0,s=t.length;n<s;n++)e+=t[n]+":"+i[t[n]]+";";return e}function Au(i){switch(i){case Int8Array:return 1/127;case Uint8Array:return 1/255;case Int16Array:return 1/32767;case Uint16Array:return 1/65535;default:throw new Error("THREE.GLTFLoader: Unsupported normalized accessor component type.")}}function Zy(i){return i.search(/\.jpe?g($|\?)/i)>0||i.search(/^data\:image\/jpeg/)===0?"image/jpeg":i.search(/\.webp($|\?)/i)>0||i.search(/^data\:image\/webp/)===0?"image/webp":i.search(/\.ktx2($|\?)/i)>0||i.search(/^data\:image\/ktx2/)===0?"image/ktx2":"image/png"}function ew(i,e,t){let n=e.attributes,s=new Tt;if(n.POSITION!==void 0){let o=t.json.accessors[n.POSITION],c=o.min,l=o.max;if(c!==void 0&&l!==void 0){if(s.set(new L(c[0],c[1],c[2]),new L(l[0],l[1],l[2])),o.normalized){let h=Au(pr[o.componentType]);s.min.multiplyScalar(h),s.max.multiplyScalar(h)}}else{console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.");return}}else return;let r=e.targets;if(r!==void 0){let o=new L,c=new L;for(let l=0,h=r.length;l<h;l++){let u=r[l];if(u.POSITION!==void 0){let d=t.json.accessors[u.POSITION],f=d.min,g=d.max;if(f!==void 0&&g!==void 0){if(c.setX(Math.max(Math.abs(f[0]),Math.abs(g[0]))),c.setY(Math.max(Math.abs(f[1]),Math.abs(g[1]))),c.setZ(Math.max(Math.abs(f[2]),Math.abs(g[2]))),d.normalized){let _=Au(pr[d.componentType]);c.multiplyScalar(_)}o.max(c)}else console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.")}}s.expandByVector(o)}i.boundingBox=s;let a=new en;s.getCenter(a.center),a.radius=s.min.distanceTo(s.max)/2,i.boundingSphere=a}function Mp(i,e,t){let n=e.attributes,s=[];function r(a,o){return t.getDependency("accessor",a).then(function(c){i.setAttribute(o,c)})}for(let a in n){let o=Su[a]||a.toLowerCase();o in i.attributes||s.push(r(n[a],o))}if(e.indices!==void 0&&!i.index){let a=t.getDependency("accessor",e.indices).then(function(o){i.setIndex(o)});s.push(a)}return ze.workingColorSpace!==Jt&&"COLOR_0"in n&&console.warn(`THREE.GLTFLoader: Converting vertex colors from "srgb-linear" to "${ze.workingColorSpace}" not supported.`),ni(i,e),ew(i,e,t),Promise.all(s).then(function(){return e.targets!==void 0?Ky(i,e.targets,t):i})}var ba,Ve,nu,iu,su,ru,au,ou,cu,lu,hu,uu,du,fu,pu,mu,gu,_u,Bc,bu,Sp,_a,vp,xu,vu,yu,wu,Hc,Xy,Mu,An,pr,yp,wp,Qh,Su,Gi,jy,eu,Qy,Eu,Tu=ct(()=>{lt();gp();xp();ba=class extends Jn{constructor(e){super(e),this.dracoLoader=null,this.ktx2Loader=null,this.meshoptDecoder=null,this.pluginCallbacks=[],this.register(function(t){return new ru(t)}),this.register(function(t){return new au(t)}),this.register(function(t){return new mu(t)}),this.register(function(t){return new gu(t)}),this.register(function(t){return new _u(t)}),this.register(function(t){return new cu(t)}),this.register(function(t){return new lu(t)}),this.register(function(t){return new hu(t)}),this.register(function(t){return new uu(t)}),this.register(function(t){return new su(t)}),this.register(function(t){return new du(t)}),this.register(function(t){return new ou(t)}),this.register(function(t){return new pu(t)}),this.register(function(t){return new fu(t)}),this.register(function(t){return new nu(t)}),this.register(function(t){return new Bc(t,Ve.EXT_MESHOPT_COMPRESSION)}),this.register(function(t){return new Bc(t,Ve.KHR_MESHOPT_COMPRESSION)}),this.register(function(t){return new bu(t)})}load(e,t,n,s){let r=this,a;if(this.resourcePath!=="")a=this.resourcePath;else if(this.path!==""){let l=gi.extractUrlBase(e);a=gi.resolveURL(l,this.path)}else a=gi.extractUrlBase(e);this.manager.itemStart(e);let o=function(l){s?s(l):console.error(l),r.manager.itemError(e),r.manager.itemEnd(e)},c=new sr(this.manager);c.setPath(this.path),c.setResponseType("arraybuffer"),c.setRequestHeader(this.requestHeader),c.setWithCredentials(this.withCredentials),c.load(e,function(l){try{r.parse(l,a,function(h){t(h),r.manager.itemEnd(e)},o)}catch(h){o(h)}},n,o)}setDRACOLoader(e){return this.dracoLoader=e,this}setKTX2Loader(e){return this.ktx2Loader=e,this}setMeshoptDecoder(e){return this.meshoptDecoder=e,this}register(e){return this.pluginCallbacks.indexOf(e)===-1&&this.pluginCallbacks.push(e),this}unregister(e){return this.pluginCallbacks.indexOf(e)!==-1&&this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(e),1),this}parse(e,t,n,s){let r,a={},o={},c=new TextDecoder;if(typeof e=="string")r=JSON.parse(e);else if(e instanceof ArrayBuffer)if(c.decode(new Uint8Array(e,0,4))===Sp){try{a[Ve.KHR_BINARY_GLTF]=new xu(e)}catch(u){s&&s(u);return}r=JSON.parse(a[Ve.KHR_BINARY_GLTF].content)}else r=JSON.parse(c.decode(e));else r=e;if(r.asset===void 0||r.asset.version[0]<2){s&&s(new Error("THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported."));return}let l=new Eu(r,{path:t||this.resourcePath||"",crossOrigin:this.crossOrigin,requestHeader:this.requestHeader,manager:this.manager,ktx2Loader:this.ktx2Loader,meshoptDecoder:this.meshoptDecoder});l.fileLoader.setRequestHeader(this.requestHeader);for(let h=0;h<this.pluginCallbacks.length;h++){let u=this.pluginCallbacks[h](l);u.name||console.error("THREE.GLTFLoader: Invalid plugin found: missing name"),o[u.name]=u,a[u.name]=!0}if(r.extensionsUsed)for(let h=0;h<r.extensionsUsed.length;++h){let u=r.extensionsUsed[h],d=r.extensionsRequired||[];switch(u){case Ve.KHR_MATERIALS_UNLIT:a[u]=new iu;break;case Ve.KHR_DRACO_MESH_COMPRESSION:a[u]=new vu(r,this.dracoLoader);break;case Ve.KHR_TEXTURE_TRANSFORM:a[u]=new yu;break;case Ve.KHR_MESH_QUANTIZATION:a[u]=new wu;break;default:d.indexOf(u)>=0&&o[u]===void 0&&console.warn('THREE.GLTFLoader: Unknown extension "'+u+'".')}}l.setExtensions(a),l.setPlugins(o),l.parse(n,s)}parseAsync(e,t){let n=this;return new Promise(function(s,r){n.parse(e,t,s,r)})}};Ve={KHR_BINARY_GLTF:"KHR_binary_glTF",KHR_DRACO_MESH_COMPRESSION:"KHR_draco_mesh_compression",KHR_LIGHTS_PUNCTUAL:"KHR_lights_punctual",KHR_MATERIALS_CLEARCOAT:"KHR_materials_clearcoat",KHR_MATERIALS_DISPERSION:"KHR_materials_dispersion",KHR_MATERIALS_IOR:"KHR_materials_ior",KHR_MATERIALS_SHEEN:"KHR_materials_sheen",KHR_MATERIALS_SPECULAR:"KHR_materials_specular",KHR_MATERIALS_TRANSMISSION:"KHR_materials_transmission",KHR_MATERIALS_IRIDESCENCE:"KHR_materials_iridescence",KHR_MATERIALS_ANISOTROPY:"KHR_materials_anisotropy",KHR_MATERIALS_UNLIT:"KHR_materials_unlit",KHR_MATERIALS_VOLUME:"KHR_materials_volume",KHR_TEXTURE_BASISU:"KHR_texture_basisu",KHR_TEXTURE_TRANSFORM:"KHR_texture_transform",KHR_MESH_QUANTIZATION:"KHR_mesh_quantization",KHR_MATERIALS_EMISSIVE_STRENGTH:"KHR_materials_emissive_strength",EXT_MATERIALS_BUMP:"EXT_materials_bump",EXT_TEXTURE_WEBP:"EXT_texture_webp",EXT_TEXTURE_AVIF:"EXT_texture_avif",EXT_MESHOPT_COMPRESSION:"EXT_meshopt_compression",KHR_MESHOPT_COMPRESSION:"KHR_meshopt_compression",EXT_MESH_GPU_INSTANCING:"EXT_mesh_gpu_instancing"},nu=class{constructor(e){this.parser=e,this.name=Ve.KHR_LIGHTS_PUNCTUAL,this.cache={refs:{},uses:{}}}_markDefs(){let e=this.parser,t=this.parser.json.nodes||[];for(let n=0,s=t.length;n<s;n++){let r=t[n];r.extensions&&r.extensions[this.name]&&r.extensions[this.name].light!==void 0&&e._addNodeRef(this.cache,r.extensions[this.name].light)}}_loadLight(e){let t=this.parser,n="light:"+e,s=t.cache.get(n);if(s)return s;let r=t.json,c=((r.extensions&&r.extensions[this.name]||{}).lights||[])[e],l,h=new Ee(16777215);c.color!==void 0&&h.setRGB(c.color[0],c.color[1],c.color[2],Jt);let u=c.range!==void 0?c.range:0;switch(c.type){case"directional":l=new $n(h),l.target.position.set(0,0,-1),l.add(l.target);break;case"point":l=new na(h),l.distance=u;break;case"spot":l=new ta(h),l.distance=u,c.spot=c.spot||{},c.spot.innerConeAngle=c.spot.innerConeAngle!==void 0?c.spot.innerConeAngle:0,c.spot.outerConeAngle=c.spot.outerConeAngle!==void 0?c.spot.outerConeAngle:Math.PI/4,l.angle=c.spot.outerConeAngle,l.penumbra=1-c.spot.innerConeAngle/c.spot.outerConeAngle,l.target.position.set(0,0,-1),l.add(l.target);break;default:throw new Error("THREE.GLTFLoader: Unexpected light type: "+c.type)}return l.position.set(0,0,0),ni(l,c),c.intensity!==void 0&&(l.intensity=c.intensity),l.name=t.createUniqueName(c.name||"light_"+e),s=Promise.resolve(l),t.cache.add(n,s),s}getDependency(e,t){if(e==="light")return this._loadLight(t)}createNodeAttachment(e){let t=this,n=this.parser,r=n.json.nodes[e],o=(r.extensions&&r.extensions[this.name]||{}).light;return o===void 0?null:this._loadLight(o).then(function(c){return n._getNodeRef(t.cache,o,c)})}},iu=class{constructor(){this.name=Ve.KHR_MATERIALS_UNLIT}getMaterialType(){return fn}extendParams(e,t,n){let s=[];e.color=new Ee(1,1,1),e.opacity=1;let r=t.pbrMetallicRoughness;if(r){if(Array.isArray(r.baseColorFactor)){let a=r.baseColorFactor;e.color.setRGB(a[0],a[1],a[2],Jt),e.opacity=a[3]}r.baseColorTexture!==void 0&&s.push(n.assignTexture(e,"map",r.baseColorTexture,Pt))}return Promise.all(s)}},su=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_EMISSIVE_STRENGTH}extendMaterialParams(e,t){let n=Mt(this.parser,e,this.name);return n===null||n.emissiveStrength!==void 0&&(t.emissiveIntensity=n.emissiveStrength),Promise.resolve()}},ru=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_CLEARCOAT}getMaterialType(e){return Mt(this.parser,e,this.name)!==null?nn:null}extendMaterialParams(e,t){let n=Mt(this.parser,e,this.name);if(n===null)return Promise.resolve();let s=[];if(n.clearcoatFactor!==void 0&&(t.clearcoat=n.clearcoatFactor),n.clearcoatTexture!==void 0&&s.push(this.parser.assignTexture(t,"clearcoatMap",n.clearcoatTexture)),n.clearcoatRoughnessFactor!==void 0&&(t.clearcoatRoughness=n.clearcoatRoughnessFactor),n.clearcoatRoughnessTexture!==void 0&&s.push(this.parser.assignTexture(t,"clearcoatRoughnessMap",n.clearcoatRoughnessTexture)),n.clearcoatNormalTexture!==void 0&&(s.push(this.parser.assignTexture(t,"clearcoatNormalMap",n.clearcoatNormalTexture)),n.clearcoatNormalTexture.scale!==void 0)){let r=n.clearcoatNormalTexture.scale;t.clearcoatNormalScale=new Ie(r,r)}return Promise.all(s)}},au=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_DISPERSION}getMaterialType(e){return Mt(this.parser,e,this.name)!==null?nn:null}extendMaterialParams(e,t){let n=Mt(this.parser,e,this.name);return n===null||(t.dispersion=n.dispersion!==void 0?n.dispersion:0),Promise.resolve()}},ou=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_IRIDESCENCE}getMaterialType(e){return Mt(this.parser,e,this.name)!==null?nn:null}extendMaterialParams(e,t){let n=Mt(this.parser,e,this.name);if(n===null)return Promise.resolve();let s=[];return n.iridescenceFactor!==void 0&&(t.iridescence=n.iridescenceFactor),n.iridescenceTexture!==void 0&&s.push(this.parser.assignTexture(t,"iridescenceMap",n.iridescenceTexture)),n.iridescenceIor!==void 0&&(t.iridescenceIOR=n.iridescenceIor),t.iridescenceThicknessRange===void 0&&(t.iridescenceThicknessRange=[100,400]),n.iridescenceThicknessMinimum!==void 0&&(t.iridescenceThicknessRange[0]=n.iridescenceThicknessMinimum),n.iridescenceThicknessMaximum!==void 0&&(t.iridescenceThicknessRange[1]=n.iridescenceThicknessMaximum),n.iridescenceThicknessTexture!==void 0&&s.push(this.parser.assignTexture(t,"iridescenceThicknessMap",n.iridescenceThicknessTexture)),Promise.all(s)}},cu=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_SHEEN}getMaterialType(e){return Mt(this.parser,e,this.name)!==null?nn:null}extendMaterialParams(e,t){let n=Mt(this.parser,e,this.name);if(n===null)return Promise.resolve();let s=[];if(t.sheenColor=new Ee(0,0,0),t.sheenRoughness=0,t.sheen=1,n.sheenColorFactor!==void 0){let r=n.sheenColorFactor;t.sheenColor.setRGB(r[0],r[1],r[2],Jt)}return n.sheenRoughnessFactor!==void 0&&(t.sheenRoughness=n.sheenRoughnessFactor),n.sheenColorTexture!==void 0&&s.push(this.parser.assignTexture(t,"sheenColorMap",n.sheenColorTexture,Pt)),n.sheenRoughnessTexture!==void 0&&s.push(this.parser.assignTexture(t,"sheenRoughnessMap",n.sheenRoughnessTexture)),Promise.all(s)}},lu=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_TRANSMISSION}getMaterialType(e){return Mt(this.parser,e,this.name)!==null?nn:null}extendMaterialParams(e,t){let n=Mt(this.parser,e,this.name);if(n===null)return Promise.resolve();let s=[];return n.transmissionFactor!==void 0&&(t.transmission=n.transmissionFactor),n.transmissionTexture!==void 0&&s.push(this.parser.assignTexture(t,"transmissionMap",n.transmissionTexture)),Promise.all(s)}},hu=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_VOLUME}getMaterialType(e){return Mt(this.parser,e,this.name)!==null?nn:null}extendMaterialParams(e,t){let n=Mt(this.parser,e,this.name);if(n===null)return Promise.resolve();let s=[];t.thickness=n.thicknessFactor!==void 0?n.thicknessFactor:0,n.thicknessTexture!==void 0&&s.push(this.parser.assignTexture(t,"thicknessMap",n.thicknessTexture)),t.attenuationDistance=n.attenuationDistance||1/0;let r=n.attenuationColor||[1,1,1];return t.attenuationColor=new Ee().setRGB(r[0],r[1],r[2],Jt),Promise.all(s)}},uu=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_IOR}getMaterialType(e){return Mt(this.parser,e,this.name)!==null?nn:null}extendMaterialParams(e,t){let n=Mt(this.parser,e,this.name);return n===null||(t.ior=n.ior!==void 0?n.ior:1.5,t.ior===0&&(t.ior=1e3)),Promise.resolve()}},du=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_SPECULAR}getMaterialType(e){return Mt(this.parser,e,this.name)!==null?nn:null}extendMaterialParams(e,t){let n=Mt(this.parser,e,this.name);if(n===null)return Promise.resolve();let s=[];t.specularIntensity=n.specularFactor!==void 0?n.specularFactor:1,n.specularTexture!==void 0&&s.push(this.parser.assignTexture(t,"specularIntensityMap",n.specularTexture));let r=n.specularColorFactor||[1,1,1];return t.specularColor=new Ee().setRGB(r[0],r[1],r[2],Jt),n.specularColorTexture!==void 0&&s.push(this.parser.assignTexture(t,"specularColorMap",n.specularColorTexture,Pt)),Promise.all(s)}},fu=class{constructor(e){this.parser=e,this.name=Ve.EXT_MATERIALS_BUMP}getMaterialType(e){return Mt(this.parser,e,this.name)!==null?nn:null}extendMaterialParams(e,t){let n=Mt(this.parser,e,this.name);if(n===null)return Promise.resolve();let s=[];return t.bumpScale=n.bumpFactor!==void 0?n.bumpFactor:1,n.bumpTexture!==void 0&&s.push(this.parser.assignTexture(t,"bumpMap",n.bumpTexture)),Promise.all(s)}},pu=class{constructor(e){this.parser=e,this.name=Ve.KHR_MATERIALS_ANISOTROPY}getMaterialType(e){return Mt(this.parser,e,this.name)!==null?nn:null}extendMaterialParams(e,t){let n=Mt(this.parser,e,this.name);if(n===null)return Promise.resolve();let s=[];return n.anisotropyStrength!==void 0&&(t.anisotropy=n.anisotropyStrength),n.anisotropyRotation!==void 0&&(t.anisotropyRotation=n.anisotropyRotation),n.anisotropyTexture!==void 0&&s.push(this.parser.assignTexture(t,"anisotropyMap",n.anisotropyTexture)),Promise.all(s)}},mu=class{constructor(e){this.parser=e,this.name=Ve.KHR_TEXTURE_BASISU}loadTexture(e){let t=this.parser,n=t.json,s=n.textures[e];if(!s.extensions||!s.extensions[this.name])return null;let r=s.extensions[this.name],a=t.options.ktx2Loader;if(!a){if(n.extensionsRequired&&n.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures");return null}return t.loadTextureImage(e,r.source,a)}},gu=class{constructor(e){this.parser=e,this.name=Ve.EXT_TEXTURE_WEBP}loadTexture(e){let t=this.name,n=this.parser,s=n.json,r=s.textures[e];if(!r.extensions||!r.extensions[t])return null;let a=r.extensions[t],o=s.images[a.source],c=n.textureLoader;if(o.uri){let l=n.options.manager.getHandler(o.uri);l!==null&&(c=l)}return n.loadTextureImage(e,a.source,c)}},_u=class{constructor(e){this.parser=e,this.name=Ve.EXT_TEXTURE_AVIF}loadTexture(e){let t=this.name,n=this.parser,s=n.json,r=s.textures[e];if(!r.extensions||!r.extensions[t])return null;let a=r.extensions[t],o=s.images[a.source],c=n.textureLoader;if(o.uri){let l=n.options.manager.getHandler(o.uri);l!==null&&(c=l)}return n.loadTextureImage(e,a.source,c)}},Bc=class{constructor(e,t){this.name=t,this.parser=e}loadBufferView(e){let t=this.parser.json,n=t.bufferViews[e];if(n.extensions&&n.extensions[this.name]){let s=n.extensions[this.name],r=this.parser.getDependency("buffer",s.buffer),a=this.parser.options.meshoptDecoder;if(!a||!a.supported){if(t.extensionsRequired&&t.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files");return null}return r.then(function(o){let c=s.byteOffset||0,l=s.byteLength||0,h=s.count,u=s.byteStride,d=new Uint8Array(o,c,l);return a.decodeGltfBufferAsync?a.decodeGltfBufferAsync(h,u,d,s.mode,s.filter).then(function(f){return f.buffer}):a.ready.then(function(){let f=new ArrayBuffer(h*u);return a.decodeGltfBuffer(new Uint8Array(f),h,u,d,s.mode,s.filter),f})})}else return null}},bu=class{constructor(e){this.name=Ve.EXT_MESH_GPU_INSTANCING,this.parser=e}createNodeMesh(e){let t=this.parser.json,n=t.nodes[e];if(!n.extensions||!n.extensions[this.name]||n.mesh===void 0)return null;let s=t.meshes[n.mesh];for(let l of s.primitives)if(l.mode!==An.TRIANGLES&&l.mode!==An.TRIANGLE_STRIP&&l.mode!==An.TRIANGLE_FAN&&l.mode!==void 0)return null;let a=n.extensions[this.name].attributes,o=[],c={};for(let l in a)o.push(this.parser.getDependency("accessor",a[l]).then(h=>(c[l]=h,c[l])));return o.length<1?null:(o.push(this.parser.createNodeMesh(e)),Promise.all(o).then(l=>{let h=l.pop(),u=h.isGroup?h.children:[h],d=l[0].count,f=[];for(let g of u){let _=new Le,m=new L,p=new ge,x=new L(1,1,1),y=new zr(g.geometry,g.material,d);for(let w=0;w<d;w++)c.TRANSLATION&&m.fromBufferAttribute(c.TRANSLATION,w),c.ROTATION&&p.fromBufferAttribute(c.ROTATION,w),c.SCALE&&x.fromBufferAttribute(c.SCALE,w),y.setMatrixAt(w,_.compose(m,p,x));for(let w in c)if(w==="_COLOR_0"){let A=c[w];y.instanceColor=new ki(A.array,A.itemSize,A.normalized)}else w!=="TRANSLATION"&&w!=="ROTATION"&&w!=="SCALE"&&g.geometry.setAttribute(w,c[w]);rt.prototype.copy.call(y,g),this.parser.assignFinalMaterial(y),f.push(y)}return h.isGroup?(h.clear(),h.add(...f),h):f[0]}))}},Sp="glTF",_a=12,vp={JSON:1313821514,BIN:5130562},xu=class{constructor(e){this.name=Ve.KHR_BINARY_GLTF,this.content=null,this.body=null;let t=new DataView(e,0,_a),n=new TextDecoder;if(this.header={magic:n.decode(new Uint8Array(e.slice(0,4))),version:t.getUint32(4,!0),length:t.getUint32(8,!0)},this.header.magic!==Sp)throw new Error("THREE.GLTFLoader: Unsupported glTF-Binary header.");if(this.header.version<2)throw new Error("THREE.GLTFLoader: Legacy binary file detected.");let s=this.header.length-_a,r=new DataView(e,_a),a=0;for(;a<s;){let o=r.getUint32(a,!0);a+=4;let c=r.getUint32(a,!0);if(a+=4,c===vp.JSON){let l=new Uint8Array(e,_a+a,o);this.content=n.decode(l)}else if(c===vp.BIN){let l=_a+a;this.body=e.slice(l,l+o)}a+=o}if(this.content===null)throw new Error("THREE.GLTFLoader: JSON content not found.")}},vu=class{constructor(e,t){if(!t)throw new Error("THREE.GLTFLoader: No DRACOLoader instance provided.");this.name=Ve.KHR_DRACO_MESH_COMPRESSION,this.json=e,this.dracoLoader=t,this.dracoLoader.preload()}decodePrimitive(e,t){let n=this.json,s=this.dracoLoader,r=e.extensions[this.name].bufferView,a=e.extensions[this.name].attributes,o={},c={},l={};for(let h in a){let u=Su[h]||h.toLowerCase();o[u]=a[h]}for(let h in e.attributes){let u=Su[h]||h.toLowerCase();if(a[h]!==void 0){let d=n.accessors[e.attributes[h]],f=pr[d.componentType];l[u]=f.name,c[u]=d.normalized===!0}}return t.getDependency("bufferView",r).then(function(h){return new Promise(function(u,d){s.decodeDracoFile(h,function(f){for(let g in f.attributes){let _=f.attributes[g],m=c[g];m!==void 0&&(_.normalized=m)}u(f)},o,l,Jt,d)})})}},yu=class{constructor(){this.name=Ve.KHR_TEXTURE_TRANSFORM}extendTexture(e,t){return(t.texCoord===void 0||t.texCoord===e.channel)&&t.offset===void 0&&t.rotation===void 0&&t.scale===void 0||(e=e.clone(),t.texCoord!==void 0&&(e.channel=t.texCoord),t.offset!==void 0&&e.offset.fromArray(t.offset),t.rotation!==void 0&&(e.rotation=t.rotation),t.scale!==void 0&&e.repeat.fromArray(t.scale),e.needsUpdate=!0),e}},wu=class{constructor(){this.name=Ve.KHR_MESH_QUANTIZATION}},Hc=class extends Yn{constructor(e,t,n,s){super(e,t,n,s)}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,s=this.valueSize,r=e*s*3+s;for(let a=0;a!==s;a++)t[a]=n[r+a];return t}interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,c=o*2,l=o*3,h=s-t,u=(n-t)/h,d=u*u,f=d*u,g=e*l,_=g-l,m=-2*f+3*d,p=f-d,x=1-m,y=p-d+u;for(let w=0;w!==o;w++){let A=a[_+w+o],S=a[_+w+c]*h,R=a[g+w+o],b=a[g+w]*h;r[w]=x*A+y*S+m*R+p*b}return r}},Xy=new ge,Mu=class extends Hc{interpolate_(e,t,n,s){let r=super.interpolate_(e,t,n,s);return Xy.fromArray(r).normalize().toArray(r),r}},An={FLOAT:5126,FLOAT_MAT3:35675,FLOAT_MAT4:35676,FLOAT_VEC2:35664,FLOAT_VEC3:35665,FLOAT_VEC4:35666,LINEAR:9729,REPEAT:10497,SAMPLER_2D:35678,POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRIANGLE_STRIP:5,TRIANGLE_FAN:6,UNSIGNED_BYTE:5121,UNSIGNED_SHORT:5123},pr={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},yp={9728:yt,9729:wt,9984:Bo,9985:or,9986:fs,9987:On},wp={33071:wn,33648:Ws,10497:Pi},Qh={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},Su={POSITION:"position",NORMAL:"normal",TANGENT:"tangent",TEXCOORD_0:"uv",TEXCOORD_1:"uv1",TEXCOORD_2:"uv2",TEXCOORD_3:"uv3",COLOR_0:"color",WEIGHTS_0:"skinWeight",JOINTS_0:"skinIndex"},Gi={scale:"scale",translation:"position",rotation:"quaternion",weights:"morphTargetInfluences"},jy={CUBICSPLINE:void 0,LINEAR:ss,STEP:is},eu={OPAQUE:"OPAQUE",MASK:"MASK",BLEND:"BLEND"};Qy=new Le,Eu=class{constructor(e={},t={}){this.json=e,this.extensions={},this.plugins={},this.options=t,this.cache=new qy,this.associations=new Map,this.primitiveCache={},this.nodeCache={},this.meshCache={refs:{},uses:{}},this.cameraCache={refs:{},uses:{}},this.lightCache={refs:{},uses:{}},this.sourceCache={},this.textureCache={},this.nodeNamesUsed={};let n=!1,s=-1,r=!1,a=-1;if(typeof navigator<"u"&&typeof navigator.userAgent<"u"){let o=navigator.userAgent;n=/^((?!chrome|android).)*safari/i.test(o)===!0;let c=o.match(/Version\/(\d+)/);s=n&&c?parseInt(c[1],10):-1,r=o.indexOf("Firefox")>-1,a=r?o.match(/Firefox\/([0-9]+)\./)[1]:-1}typeof createImageBitmap>"u"||n&&s<17||r&&a<98?this.textureLoader=new Zr(this.options.manager):this.textureLoader=new ia(this.options.manager),this.textureLoader.setCrossOrigin(this.options.crossOrigin),this.textureLoader.setRequestHeader(this.options.requestHeader),this.fileLoader=new sr(this.options.manager),this.fileLoader.setResponseType("arraybuffer"),this.options.crossOrigin==="use-credentials"&&this.fileLoader.setWithCredentials(!0)}setExtensions(e){this.extensions=e}setPlugins(e){this.plugins=e}parse(e,t){let n=this,s=this.json,r=this.extensions;this.cache.removeAll(),this.nodeCache={},this._invokeAll(function(a){return a._markDefs&&a._markDefs()}),Promise.all(this._invokeAll(function(a){return a.beforeRoot&&a.beforeRoot()})).then(function(){return Promise.all([n.getDependencies("scene"),n.getDependencies("animation"),n.getDependencies("camera")])}).then(function(a){let o={scene:a[0][s.scene||0],scenes:a[0],animations:a[1],cameras:a[2],asset:s.asset,parser:n,userData:{}};return bs(r,o,s),ni(o,s),Promise.all(n._invokeAll(function(c){return c.afterRoot&&c.afterRoot(o)})).then(function(){for(let c of o.scenes)c.updateMatrixWorld();e(o)})}).catch(t)}_markDefs(){let e=this.json.nodes||[],t=this.json.skins||[],n=this.json.meshes||[];for(let s=0,r=t.length;s<r;s++){let a=t[s].joints;for(let o=0,c=a.length;o<c;o++)e[a[o]].isBone=!0}for(let s=0,r=e.length;s<r;s++){let a=e[s];a.mesh!==void 0&&(this._addNodeRef(this.meshCache,a.mesh),a.skin!==void 0&&(n[a.mesh].isSkinnedMesh=!0)),a.camera!==void 0&&this._addNodeRef(this.cameraCache,a.camera)}}_addNodeRef(e,t){t!==void 0&&(e.refs[t]===void 0&&(e.refs[t]=e.uses[t]=0),e.refs[t]++)}_getNodeRef(e,t,n){if(e.refs[t]<=1)return n;let s=n.clone(),r=(a,o)=>{let c=this.associations.get(a);c!=null&&this.associations.set(o,c);for(let[l,h]of a.children.entries())r(h,o.children[l])};return r(n,s),s.name+="_instance_"+e.uses[t]++,s}_invokeOne(e){let t=Object.values(this.plugins);t.push(this);for(let n=0;n<t.length;n++){let s=e(t[n]);if(s)return s}return null}_invokeAll(e){let t=Object.values(this.plugins);t.unshift(this);let n=[];for(let s=0;s<t.length;s++){let r=e(t[s]);r&&n.push(r)}return n}getDependency(e,t){let n=e+":"+t,s=this.cache.get(n);if(!s){switch(e){case"scene":s=this.loadScene(t);break;case"node":s=this._invokeOne(function(r){return r.loadNode&&r.loadNode(t)});break;case"mesh":s=this._invokeOne(function(r){return r.loadMesh&&r.loadMesh(t)});break;case"accessor":s=this.loadAccessor(t);break;case"bufferView":s=this._invokeOne(function(r){return r.loadBufferView&&r.loadBufferView(t)});break;case"buffer":s=this.loadBuffer(t);break;case"material":s=this._invokeOne(function(r){return r.loadMaterial&&r.loadMaterial(t)});break;case"texture":s=this._invokeOne(function(r){return r.loadTexture&&r.loadTexture(t)});break;case"skin":s=this.loadSkin(t);break;case"animation":s=this._invokeOne(function(r){return r.loadAnimation&&r.loadAnimation(t)});break;case"camera":s=this.loadCamera(t);break;default:if(s=this._invokeOne(function(r){return r!=this&&r.getDependency&&r.getDependency(e,t)}),!s)throw new Error("Unknown type: "+e);break}this.cache.add(n,s)}return s}getDependencies(e){let t=this.cache.get(e);if(!t){let n=this,s=this.json[e+(e==="mesh"?"es":"s")]||[];t=Promise.all(s.map(function(r,a){return n.getDependency(e,a)})),this.cache.add(e,t)}return t}loadBuffer(e){let t=this.json.buffers[e],n=this.fileLoader;if(t.type&&t.type!=="arraybuffer")throw new Error("THREE.GLTFLoader: "+t.type+" buffer type is not supported.");if(t.uri===void 0&&e===0)return Promise.resolve(this.extensions[Ve.KHR_BINARY_GLTF].body);let s=this.options;return new Promise(function(r,a){n.load(gi.resolveURL(t.uri,s.path),r,void 0,function(){a(new Error('THREE.GLTFLoader: Failed to load buffer "'+t.uri+'".'))})})}loadBufferView(e){let t=this.json.bufferViews[e];return this.getDependency("buffer",t.buffer).then(function(n){let s=t.byteLength||0,r=t.byteOffset||0;return n.slice(r,r+s)})}loadAccessor(e){let t=this,n=this.json,s=this.json.accessors[e];if(s.bufferView===void 0&&s.sparse===void 0){let a=Qh[s.type],o=pr[s.componentType],c=s.normalized===!0,l=new o(s.count*a);return Promise.resolve(new Et(l,a,c))}let r=[];return s.bufferView!==void 0?r.push(this.getDependency("bufferView",s.bufferView)):r.push(null),s.sparse!==void 0&&(r.push(this.getDependency("bufferView",s.sparse.indices.bufferView)),r.push(this.getDependency("bufferView",s.sparse.values.bufferView))),Promise.all(r).then(function(a){let o=a[0],c=Qh[s.type],l=pr[s.componentType],h=l.BYTES_PER_ELEMENT,u=h*c,d=s.byteOffset||0,f=s.bufferView!==void 0?n.bufferViews[s.bufferView].byteStride:void 0,g=s.normalized===!0,_,m;if(f&&f!==u){let p=Math.floor(d/f),x="InterleavedBuffer:"+s.bufferView+":"+s.componentType+":"+p+":"+s.count,y=t.cache.get(x);y||(_=new l(o,p*f,s.count*f/h),y=new Js(_,f/h),t.cache.add(x,y)),m=new $s(y,c,d%f/h,g)}else o===null?_=new l(s.count*c):_=new l(o,d,s.count*c),m=new Et(_,c,g);if(s.sparse!==void 0){let p=Qh.SCALAR,x=pr[s.sparse.indices.componentType],y=s.sparse.indices.byteOffset||0,w=s.sparse.values.byteOffset||0,A=new x(a[1],y,s.sparse.count*p),S=new l(a[2],w,s.sparse.count*c);o!==null&&(m=new Et(m.array.slice(),m.itemSize,m.normalized)),m.normalized=!1;for(let R=0,b=A.length;R<b;R++){let T=A[R];if(m.setX(T,S[R*c]),c>=2&&m.setY(T,S[R*c+1]),c>=3&&m.setZ(T,S[R*c+2]),c>=4&&m.setW(T,S[R*c+3]),c>=5)throw new Error("THREE.GLTFLoader: Unsupported itemSize in sparse BufferAttribute.")}m.normalized=g}return m})}loadTexture(e){let t=this.json,n=this.options,r=t.textures[e].source,a=t.images[r],o=this.textureLoader;if(a.uri){let c=n.manager.getHandler(a.uri);c!==null&&(o=c)}return this.loadTextureImage(e,r,o)}loadTextureImage(e,t,n){let s=this,r=this.json,a=r.textures[e],o=r.images[t],c=(o.uri||o.bufferView)+":"+a.sampler;if(this.textureCache[c])return this.textureCache[c];let l=this.loadImageSource(t,n).then(function(h){h.flipY=!1,h.name=a.name||o.name||"",h.name===""&&typeof o.uri=="string"&&o.uri.startsWith("data:image/")===!1&&(h.name=o.uri);let d=(r.samplers||{})[a.sampler]||{};return h.magFilter=yp[d.magFilter]||wt,h.minFilter=yp[d.minFilter]||On,h.wrapS=wp[d.wrapS]||Pi,h.wrapT=wp[d.wrapT]||Pi,h.generateMipmaps=!h.isCompressedTexture&&h.minFilter!==yt&&h.minFilter!==wt,s.associations.set(h,{textures:e}),h}).catch(function(){return null});return this.textureCache[c]=l,l}loadImageSource(e,t){let n=this,s=this.json,r=this.options;if(this.sourceCache[e]!==void 0)return this.sourceCache[e].then(u=>u.clone());let a=s.images[e],o=self.URL||self.webkitURL,c=a.uri||"",l=!1;if(a.bufferView!==void 0)c=n.getDependency("bufferView",a.bufferView).then(function(u){l=!0;let d=new Blob([u],{type:a.mimeType});return c=o.createObjectURL(d),c});else if(a.uri===void 0)throw new Error("THREE.GLTFLoader: Image "+e+" is missing URI and bufferView");let h=Promise.resolve(c).then(function(u){return new Promise(function(d,f){let g=d;t.isImageBitmapLoader===!0&&(g=function(_){let m=new Ot(_);m.needsUpdate=!0,d(m)}),t.load(gi.resolveURL(u,r.path),g,void 0,f)})}).then(function(u){return l===!0&&o.revokeObjectURL(c),ni(u,a),u.userData.mimeType=a.mimeType||Zy(a.uri),u}).catch(function(u){throw console.error("THREE.GLTFLoader: Couldn't load texture",c),u});return this.sourceCache[e]=h,h}assignTexture(e,t,n,s){let r=this;return this.getDependency("texture",n.index).then(function(a){if(!a)return null;if(n.texCoord!==void 0&&n.texCoord>0&&(a=a.clone(),a.channel=n.texCoord),r.extensions[Ve.KHR_TEXTURE_TRANSFORM]){let o=n.extensions!==void 0?n.extensions[Ve.KHR_TEXTURE_TRANSFORM]:void 0;if(o){let c=r.associations.get(a);a=r.extensions[Ve.KHR_TEXTURE_TRANSFORM].extendTexture(a,o),r.associations.set(a,c)}}return s!==void 0&&(a.colorSpace=s),e[t]=a,a})}assignFinalMaterial(e){let t=e.geometry,n=e.material,s=t.attributes.tangent===void 0,r=t.attributes.color!==void 0,a=t.attributes.normal===void 0;if(e.isPoints){let o="PointsMaterial:"+n.uuid,c=this.cache.get(o);c||(c=new nr,tn.prototype.copy.call(c,n),c.color.copy(n.color),c.map=n.map,c.sizeAttenuation=!1,this.cache.add(o,c)),n=c}else if(e.isLine){let o="LineBasicMaterial:"+n.uuid,c=this.cache.get(o);c||(c=new tr,tn.prototype.copy.call(c,n),c.color.copy(n.color),c.map=n.map,this.cache.add(o,c)),n=c}if(s||r||a){let o="ClonedMaterial:"+n.uuid+":";s&&(o+="derivative-tangents:"),r&&(o+="vertex-colors:"),a&&(o+="flat-shading:");let c=this.cache.get(o);c||(c=n.clone(),r&&(c.vertexColors=!0),a&&(c.flatShading=!0),s&&(c.normalScale&&(c.normalScale.y*=-1),c.clearcoatNormalScale&&(c.clearcoatNormalScale.y*=-1)),this.cache.add(o,c),this.associations.set(c,this.associations.get(n))),n=c}e.material=n}getMaterialType(){return hs}loadMaterial(e){let t=this,n=this.json,s=this.extensions,r=n.materials[e],a,o={},c=r.extensions||{},l=[];if(c[Ve.KHR_MATERIALS_UNLIT]){let u=s[Ve.KHR_MATERIALS_UNLIT];a=u.getMaterialType(),l.push(u.extendParams(o,r,t))}else{let u=r.pbrMetallicRoughness||{};if(o.color=new Ee(1,1,1),o.opacity=1,Array.isArray(u.baseColorFactor)){let d=u.baseColorFactor;o.color.setRGB(d[0],d[1],d[2],Jt),o.opacity=d[3]}u.baseColorTexture!==void 0&&l.push(t.assignTexture(o,"map",u.baseColorTexture,Pt)),o.metalness=u.metallicFactor!==void 0?u.metallicFactor:1,o.roughness=u.roughnessFactor!==void 0?u.roughnessFactor:1,u.metallicRoughnessTexture!==void 0&&(l.push(t.assignTexture(o,"metalnessMap",u.metallicRoughnessTexture)),l.push(t.assignTexture(o,"roughnessMap",u.metallicRoughnessTexture))),a=this._invokeOne(function(d){return d.getMaterialType&&d.getMaterialType(e)}),l.push(Promise.all(this._invokeAll(function(d){return d.extendMaterialParams&&d.extendMaterialParams(e,o)})))}r.doubleSided===!0&&(o.side=rn);let h=r.alphaMode||eu.OPAQUE;if(h===eu.BLEND?(o.transparent=!0,o.depthWrite=!1):(o.transparent=!1,h===eu.MASK&&(o.alphaTest=r.alphaCutoff!==void 0?r.alphaCutoff:.5)),r.normalTexture!==void 0&&a!==fn&&(l.push(t.assignTexture(o,"normalMap",r.normalTexture)),o.normalScale=new Ie(1,1),r.normalTexture.scale!==void 0)){let u=r.normalTexture.scale;o.normalScale.set(u,u)}if(r.occlusionTexture!==void 0&&a!==fn&&(l.push(t.assignTexture(o,"aoMap",r.occlusionTexture)),r.occlusionTexture.strength!==void 0&&(o.aoMapIntensity=r.occlusionTexture.strength)),r.emissiveFactor!==void 0&&a!==fn){let u=r.emissiveFactor;o.emissive=new Ee().setRGB(u[0],u[1],u[2],Jt)}return r.emissiveTexture!==void 0&&a!==fn&&l.push(t.assignTexture(o,"emissiveMap",r.emissiveTexture,Pt)),Promise.all(l).then(function(){let u=new a(o);return r.name&&(u.name=r.name),ni(u,r),t.associations.set(u,{materials:e}),r.extensions&&bs(s,u,r),u})}createUniqueName(e){let t=it.sanitizeNodeName(e||"");return t in this.nodeNamesUsed?t+"_"+ ++this.nodeNamesUsed[t]:(this.nodeNamesUsed[t]=0,t)}loadGeometries(e){let t=this,n=this.extensions,s=this.primitiveCache;function r(o){return n[Ve.KHR_DRACO_MESH_COMPRESSION].decodePrimitive(o,t).then(function(c){return Mp(c,o,t)})}let a=[];for(let o=0,c=e.length;o<c;o++){let l=e[o],h=$y(l),u=s[h];if(u)a.push(u.promise);else{let d;l.extensions&&l.extensions[Ve.KHR_DRACO_MESH_COMPRESSION]?d=r(l):d=Mp(new Xt,l,t),s[h]={primitive:l,promise:d},a.push(d)}}return Promise.all(a)}loadMesh(e){let t=this,n=this.json,s=this.extensions,r=n.meshes[e],a=r.primitives,o=[];for(let c=0,l=a.length;c<l;c++){let h=a[c].material===void 0?Yy(this.cache):this.getDependency("material",a[c].material);o.push(h)}return o.push(t.loadGeometries(a)),Promise.all(o).then(function(c){let l=c.slice(0,c.length-1),h=c[c.length-1],u=[];for(let f=0,g=h.length;f<g;f++){let _=h[f],m=a[f],p,x=l[f];if(m.mode===An.TRIANGLES||m.mode===An.TRIANGLE_STRIP||m.mode===An.TRIANGLE_FAN||m.mode===void 0)p=r.isSkinnedMesh===!0?new os(_,x):new It(_,x),p.isSkinnedMesh===!0&&p.normalizeSkinWeights(),m.mode===An.TRIANGLE_STRIP?p.geometry=Zh(p.geometry,fa):m.mode===An.TRIANGLE_FAN&&(p.geometry=Zh(p.geometry,hr));else if(m.mode===An.LINES)p=new Vr(_,x);else if(m.mode===An.LINE_STRIP)p=new ls(_,x);else if(m.mode===An.LINE_LOOP)p=new Gr(_,x);else if(m.mode===An.POINTS)p=new Wr(_,x);else throw new Error("THREE.GLTFLoader: Primitive mode unsupported: "+m.mode);Object.keys(p.geometry.morphAttributes).length>0&&Jy(p,r),p.name=t.createUniqueName(r.name||"mesh_"+e),ni(p,r),m.extensions&&bs(s,p,m),t.assignFinalMaterial(p),u.push(p)}for(let f=0,g=u.length;f<g;f++)t.associations.set(u[f],{meshes:e,primitives:f});if(u.length===1)return r.extensions&&bs(s,u[0],r),u[0];let d=new Nt;r.extensions&&bs(s,d,r),t.associations.set(d,{meshes:e});for(let f=0,g=u.length;f<g;f++)d.add(u[f]);return d})}loadCamera(e){let t,n=this.json.cameras[e],s=n[n.type];if(!s){console.warn("THREE.GLTFLoader: Missing camera parameters.");return}return n.type==="perspective"?t=new At(_t.radToDeg(s.yfov),s.aspectRatio||1,s.znear||1,s.zfar||2e6):n.type==="orthographic"&&(t=new Nn(-s.xmag,s.xmag,s.ymag,-s.ymag,s.znear,s.zfar)),n.name&&(t.name=this.createUniqueName(n.name)),ni(t,n),Promise.resolve(t)}loadSkin(e){let t=this.json.skins[e],n=[];for(let s=0,r=t.joints.length;s<r;s++)n.push(this._loadNodeShallow(t.joints[s]));return t.inverseBindMatrices!==void 0?n.push(this.getDependency("accessor",t.inverseBindMatrices)):n.push(null),Promise.all(n).then(function(s){let r=s.pop(),a=s,o=[],c=[];for(let l=0,h=a.length;l<h;l++){let u=a[l];if(u){o.push(u);let d=new Le;r!==null&&d.fromArray(r.array,l*16),c.push(d)}else console.warn('THREE.GLTFLoader: Joint "%s" could not be found.',t.joints[l])}return new cs(o,c)})}loadAnimation(e){let t=this.json,n=this,s=t.animations[e],r=s.name?s.name:"animation_"+e,a=[],o=[],c=[],l=[],h=[];for(let u=0,d=s.channels.length;u<d;u++){let f=s.channels[u],g=s.samplers[f.sampler],_=f.target,m=_.node,p=s.parameters!==void 0?s.parameters[g.input]:g.input,x=s.parameters!==void 0?s.parameters[g.output]:g.output;_.node!==void 0&&(a.push(this.getDependency("node",m)),o.push(this.getDependency("accessor",p)),c.push(this.getDependency("accessor",x)),l.push(g),h.push(_))}return Promise.all([Promise.all(a),Promise.all(o),Promise.all(c),Promise.all(l),Promise.all(h)]).then(function(u){let d=u[0],f=u[1],g=u[2],_=u[3],m=u[4],p=[];for(let y=0,w=d.length;y<w;y++){let A=d[y],S=f[y],R=g[y],b=_[y],T=m[y];if(A===void 0)continue;A.updateMatrix&&A.updateMatrix();let P=n._createAnimationTracks(A,S,R,b,T);if(P)for(let C=0;C<P.length;C++)p.push(P[C])}let x=new $t(r,void 0,p);return ni(x,s),x})}createNodeMesh(e){let t=this.json,n=this,s=t.nodes[e];return s.mesh===void 0?null:n.getDependency("mesh",s.mesh).then(function(r){let a=n._getNodeRef(n.meshCache,s.mesh,r);return s.weights!==void 0&&a.traverse(function(o){if(o.isMesh)for(let c=0,l=s.weights.length;c<l;c++)o.morphTargetInfluences[c]=s.weights[c]}),a})}loadNode(e){let t=this.json,n=this,s=t.nodes[e],r=n._loadNodeShallow(e),a=[],o=s.children||[];for(let l=0,h=o.length;l<h;l++)a.push(n.getDependency("node",o[l]));let c=s.skin===void 0?Promise.resolve(null):n.getDependency("skin",s.skin);return Promise.all([r,Promise.all(a),c]).then(function(l){let h=l[0],u=l[1],d=l[2];d!==null&&h.traverse(function(f){f.isSkinnedMesh&&f.bind(d,Qy)});for(let f=0,g=u.length;f<g;f++)h.add(u[f]);if(h.userData.pivot!==void 0&&u.length>0){let f=h.userData.pivot,g=u[0];h.pivot=new L().fromArray(f),h.position.x-=f[0],h.position.y-=f[1],h.position.z-=f[2],g.position.set(0,0,0),delete h.userData.pivot}return h})}_loadNodeShallow(e){let t=this.json,n=this.extensions,s=this;if(this.nodeCache[e]!==void 0)return this.nodeCache[e];let r=t.nodes[e],a=r.name?s.createUniqueName(r.name):"",o=[],c=s._invokeOne(function(l){return l.createNodeMesh&&l.createNodeMesh(e)});return c&&o.push(c),r.camera!==void 0&&o.push(s.getDependency("camera",r.camera).then(function(l){return s._getNodeRef(s.cameraCache,r.camera,l)})),s._invokeAll(function(l){return l.createNodeAttachment&&l.createNodeAttachment(e)}).forEach(function(l){o.push(l)}),this.nodeCache[e]=Promise.all(o).then(function(l){let h;if(r.isBone===!0?h=new Zs:l.length>1?h=new Nt:l.length===1?h=l[0]:h=new rt,h!==l[0])for(let u=0,d=l.length;u<d;u++)h.add(l[u]);if(r.name&&(h.userData.name=r.name,h.name=a),ni(h,r),r.extensions&&bs(n,h,r),r.matrix!==void 0){let u=new Le;u.fromArray(r.matrix),h.applyMatrix4(u)}else r.translation!==void 0&&h.position.fromArray(r.translation),r.rotation!==void 0&&h.quaternion.fromArray(r.rotation),r.scale!==void 0&&h.scale.fromArray(r.scale);if(!s.associations.has(h))s.associations.set(h,{});else if(r.mesh!==void 0&&s.meshCache.refs[r.mesh]>1){let u=s.associations.get(h);s.associations.set(h,{...u})}return s.associations.get(h).nodes=e,h}),this.nodeCache[e]}loadScene(e){let t=this.extensions,n=this.json.scenes[e],s=this,r=new Nt;n.name&&(r.name=s.createUniqueName(n.name)),ni(r,n),n.extensions&&bs(t,r,n);let a=n.nodes||[],o=[];for(let c=0,l=a.length;c<l;c++)o.push(s.getDependency("node",a[c]));return Promise.all(o).then(function(c){for(let h=0,u=c.length;h<u;h++){let d=c[h];d.parent!==null?r.add(_p(d)):r.add(d)}let l=h=>{let u=new Map;for(let[d,f]of s.associations)(d instanceof tn||d instanceof Ot)&&u.set(d,f);return h.traverse(d=>{let f=s.associations.get(d);f!=null&&u.set(d,f)}),u};return s.associations=l(r),r})}_createAnimationTracks(e,t,n,s,r){let a=[],o=e.name?e.name:e.uuid,c=[];function l(f){f.morphTargetInfluences&&c.push(f.name?f.name:f.uuid)}Gi[r.path]===Gi.weights?(l(e),e.isGroup&&e.children.forEach(l)):c.push(o);let h;switch(Gi[r.path]){case Gi.weights:h=Mn;break;case Gi.rotation:h=Sn;break;case Gi.translation:case Gi.scale:h=Kn;break;default:n.itemSize===1?h=Mn:h=Kn;break}let u=s.interpolation!==void 0?jy[s.interpolation]:ss,d=this._getArrayFromAccessor(n);for(let f=0,g=c.length;f<g;f++){let _=new h(c[f]+"."+Gi[r.path],t.array,d,u);s.interpolation==="CUBICSPLINE"&&this._createCubicSplineTrackInterpolant(_),a.push(_)}return a}_getArrayFromAccessor(e){let t=e.array;if(e.normalized){let n=Au(t.constructor),s=new Float32Array(t.length);for(let r=0,a=t.length;r<a;r++)s[r]=t[r]*n;t=s}return t}_createCubicSplineTrackInterpolant(e){e.createInterpolant=function(n){let s=this instanceof Sn?Mu:Hc;return new s(this.times,this.values,this.getValueSize()/3,n)},e.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline=!0}}});var Ep={};Ca(Ep,{MeshoptDecoder:()=>tw});var tw,Tp=ct(()=>{tw=(function(){var i="b9H79Tebbbe8Fv9Gbb9Gvuuuuueu9Giuuub9Geueu9Giuuueuixkbeeeddddillviebeoweuecj:Gdkr;Neqo9TW9T9VV95dbH9F9F939H79T9F9J9H229F9Jt9VV7bb8A9TW79O9V9Wt9F9KW9J9V9KW9wWVtW949c919M9MWVbeY9TW79O9V9Wt9F9KW9J9V9KW69U9KW949c919M9MWVbdE9TW79O9V9Wt9F9KW9J9V9KW69U9KW949tWG91W9U9JWbiL9TW79O9V9Wt9F9KW9J9V9KWS9P2tWV9p9JtblK9TW79O9V9Wt9F9KW9J9V9KWS9P2tWV9r919HtbvL9TW79O9V9Wt9F9KW9J9V9KWS9P2tWVT949WboY9TW79O9V9Wt9F9KW9J9V9KWS9P2tWVJ9V29VVbrl79IV9Rbwq:VZkdbk:XYi5ud9:du8Jjjjjbcj;kb9Rgv8Kjjjjbc9:hodnalTmbcuhoaiRbbgrc;WeGc:Ge9hmbarcsGgwce0mbc9:hoalcufadcd4cbawEgDadfgrcKcaawEgqaraq0Egk6mbaicefhxcj;abad9Uc;WFbGcjdadca0EhmaialfgPar9Rgoadfhsavaoadz:jjjjbgzceVhHcbhOdndninaeaO9nmeaPax9RaD6mdamaeaO9RaOamfgoae6EgAcsfglc9WGhCabaOad2fhXaAcethQaxaDfhiaOaeaoaeao6E9RhLalcl4cifcd4hKazcj;cbfaAfhYcbh8AazcjdfhEaHh3incbh5dnawTmbaxa8Acd4fRbbh5kcbh8Eazcj;cbfhqinaih8Fdndndndna5a8Ecet4ciGgoc9:fPdebdkaPa8F9RaA6mrazcj;cbfa8EaA2fa8FaAz:jjjjb8Aa8FaAfhixdkazcj;cbfa8EaA2fcbaAz:kjjjb8Aa8FhixekaPa8F9RaK6mva8FaKfhidnaCTmbaPai9RcK6mbaocdtc:q:G:cjbfcj:G:cjbawEhaczhrcbhlinargoc9Wfghaqfhrdndndndndndnaaa8Fahco4fRbbalcoG4ciGcdtfydbPDbedvivvvlvkar9cb83bwar9cb83bbxlkarcbaiRbdai8Xbb9c:c:qj:bw9:9c:q;c1:I1e:d9c:b:c:e1z9:gg9cjjjjjz:dg8J9qE86bbaqaofgrcGfcbaicdfa8J9c8N1:NfghRbbag9cjjjjjw:dg8J9qE86bbarcVfcbaha8J9c8M1:NfghRbbag9cjjjjjl:dg8J9qE86bbarc7fcbaha8J9c8L1:NfghRbbag9cjjjjjd:dg8J9qE86bbarctfcbaha8J9c8K1:NfghRbbag9cjjjjje:dg8J9qE86bbarc91fcbaha8J9c8J1:NfghRbbag9cjjjj;ab:dg8J9qE86bbarc4fcbaha8J9cg1:NfghRbbag9cjjjja:dg8J9qE86bbarc93fcbaha8J9ch1:NfghRbbag9cjjjjz:dgg9qE86bbarc94fcbahag9ca1:NfghRbbai8Xbe9c:c:qj:bw9:9c:q;c1:I1e:d9c:b:c:e1z9:gg9cjjjjjz:dg8J9qE86bbarc95fcbaha8J9c8N1:NfgiRbbag9cjjjjjw:dg8J9qE86bbarc96fcbaia8J9c8M1:NfgiRbbag9cjjjjjl:dg8J9qE86bbarc97fcbaia8J9c8L1:NfgiRbbag9cjjjjjd:dg8J9qE86bbarc98fcbaia8J9c8K1:NfgiRbbag9cjjjjje:dg8J9qE86bbarc99fcbaia8J9c8J1:NfgiRbbag9cjjjj;ab:dg8J9qE86bbarc9:fcbaia8J9cg1:NfgiRbbag9cjjjja:dg8J9qE86bbarcufcbaia8J9ch1:NfgiRbbag9cjjjjz:dgg9qE86bbaiag9ca1:NfhixikaraiRblaiRbbghco4g8Ka8KciSg8KE86bbaqaofgrcGfaiclfa8Kfg8KRbbahcl4ciGg8La8LciSg8LE86bbarcVfa8Ka8Lfg8KRbbahcd4ciGg8La8LciSg8LE86bbarc7fa8Ka8Lfg8KRbbahciGghahciSghE86bbarctfa8Kahfg8KRbbaiRbeghco4g8La8LciSg8LE86bbarc91fa8Ka8Lfg8KRbbahcl4ciGg8La8LciSg8LE86bbarc4fa8Ka8Lfg8KRbbahcd4ciGg8La8LciSg8LE86bbarc93fa8Ka8Lfg8KRbbahciGghahciSghE86bbarc94fa8Kahfg8KRbbaiRbdghco4g8La8LciSg8LE86bbarc95fa8Ka8Lfg8KRbbahcl4ciGg8La8LciSg8LE86bbarc96fa8Ka8Lfg8KRbbahcd4ciGg8La8LciSg8LE86bbarc97fa8Ka8Lfg8KRbbahciGghahciSghE86bbarc98fa8KahfghRbbaiRbigico4g8Ka8KciSg8KE86bbarc99faha8KfghRbbaicl4ciGg8Ka8KciSg8KE86bbarc9:faha8KfghRbbaicd4ciGg8Ka8KciSg8KE86bbarcufaha8KfgrRbbaiciGgiaiciSgiE86bbaraifhixdkaraiRbwaiRbbghcl4g8Ka8KcsSg8KE86bbaqaofgrcGfaicwfa8Kfg8KRbbahcsGghahcsSghE86bbarcVfa8KahfghRbbaiRbeg8Kcl4g8La8LcsSg8LE86bbarc7faha8LfghRbba8KcsGg8Ka8KcsSg8KE86bbarctfaha8KfghRbbaiRbdg8Kcl4g8La8LcsSg8LE86bbarc91faha8LfghRbba8KcsGg8Ka8KcsSg8KE86bbarc4faha8KfghRbbaiRbig8Kcl4g8La8LcsSg8LE86bbarc93faha8LfghRbba8KcsGg8Ka8KcsSg8KE86bbarc94faha8KfghRbbaiRblg8Kcl4g8La8LcsSg8LE86bbarc95faha8LfghRbba8KcsGg8Ka8KcsSg8KE86bbarc96faha8KfghRbbaiRbvg8Kcl4g8La8LcsSg8LE86bbarc97faha8LfghRbba8KcsGg8Ka8KcsSg8KE86bbarc98faha8KfghRbbaiRbog8Kcl4g8La8LcsSg8LE86bbarc99faha8LfghRbba8KcsGg8Ka8KcsSg8KE86bbarc9:faha8KfghRbbaiRbrgicl4g8Ka8KcsSg8KE86bbarcufaha8KfgrRbbaicsGgiaicsSgiE86bbaraifhixekarai8Pbw83bwarai8Pbb83bbaiczfhikdnaoaC9pmbalcdfhlaoczfhraPai9RcL0mekkaoaC6moaimexokaCmva8FTmvkaqaAfhqa8Ecefg8Ecl9hmbkdndndndnawTmbasa8Acd4fRbbgociGPlbedrbkaATmdaza8Afh8Fazcj;cbfhhcbh8EaEhaina8FRbbhraahocbhlinaoahalfRbbgqce4cbaqceG9R7arfgr86bbaoadfhoaAalcefgl9hmbkaacefhaa8Fcefh8FahaAfhha8Ecefg8Ecl9hmbxikkaATmeaza8Afhaazcj;cbfhhcbhoceh8EaYh8FinaEaofhlaa8Vbbhrcbhoinala8FaofRbbcwtahaofRbbgqVc;:FiGce4cbaqceG9R7arfgr87bbaladfhlaLaocefgofmbka8FaQfh8FcdhoaacdfhaahaQfhha8EceGhlcbh8EalmbxdkkaATmbaocl4h8Eaza8AfRbbhqcwhoa3hlinalRbbaotaqVhqalcefhlaocwfgoca9hmbkcbhhaEh8FaYhainazcj;cbfahfRbbhrcwhoaahlinalRbbaotarVhralaAfhlaocwfgoca9hmbkara8E94aq7hqcbhoa8Fhlinalaqao486bbalcefhlaocwfgoca9hmbka8Fadfh8FaacefhaahcefghaA9hmbkkaEclfhEa3clfh3a8Aclfg8Aad6mbkaXazcjdfaAad2z:jjjjb8AazazcjdfaAcufad2fadz:jjjjb8AaAaOfhOaihxaimbkc9:hoxdkcbc99aPax9RakSEhoxekc9:hokavcj;kbf8Kjjjjbaok:ysezu8Jjjjjbc;ae9Rgv8Kjjjjbc9:hodnalaeci9UgrcHf6mbcuhoaiRbbgwc;WeGc;Ge9hmbawcsGgDce0mbavc;abfcFecjez:kjjjb8Aav9cu83iUav9cu83i8Wav9cu83iyav9cu83iaav9cu83iKav9cu83izav9cu83iwav9cu83ibaialfc9WfhqaicefgwarfhldnaeTmbcmcsaDceSEhkcbhxcbhmcbhrcbhicbhoindnalaq9nmbc9:hoxikdndnawRbbgDc;Ve0mbavc;abfaoaDcu7gPcl4fcsGcitfgsydlhzasydbhHdndnaDcsGgsak9pmbavaiaPfcsGcdtfydbaxasEhDaxasTgOfhxxekdndnascsSmbcehOasc987asamffcefhDxekalcefhDal8SbbgscFeGhPdndnascu9mmbaDhlxekalcvfhlaPcFbGhPcrhsdninaD8SbbgOcFbGastaPVhPaOcu9kmeaDcefhDascrfgsc8J9hmbxdkkaDcefhlkcehOaPce4cbaPceG9R7amfhDkaDhmkavc;abfaocitfgsaDBdbasazBdlavaicdtfaDBdbavc;abfaocefcsGcitfgsaHBdbasaDBdlaocdfhoaOaifhidnadcd9hmbabarcetfgsaH87ebasclfaD87ebascdfaz87ebxdkabarcdtfgsaHBdbascwfaDBdbasclfazBdbxekdnaDcpe0mbavaiaqaDcsGfRbbgscl4gP9RcsGcdtfydbaxcefgOaPEhDavaias9RcsGcdtfydbaOaPTgzfgOascsGgPEhsaPThPdndnadcd9hmbabarcetfgHax87ebaHclfas87ebaHcdfaD87ebxekabarcdtfgHaxBdbaHcwfasBdbaHclfaDBdbkavaicdtfaxBdbavc;abfaocitfgHaDBdbaHaxBdlavaicefgicsGcdtfaDBdbavc;abfaocefcsGcitfgHasBdbaHaDBdlavaiazfgicsGcdtfasBdbavc;abfaocdfcsGcitfgDaxBdbaDasBdlaocifhoaiaPfhiaOaPfhxxekaxcbalRbbgsEgHaDc;:eSgDfhOascsGhAdndnascl4gCmbaOcefhzxekaOhzavaiaC9RcsGcdtfydbhOkdndnaAmbazcefhxxekazhxavaias9RcsGcdtfydbhzkdndnaDTmbalcefhDxekalcdfhDal8SbegPcFeGhsdnaPcu9kmbalcofhHascFbGhscrhldninaD8SbbgPcFbGaltasVhsaPcu9kmeaDcefhDalcrfglc8J9hmbkaHhDxekaDcefhDkasce4cbasceG9R7amfgmhHkdndnaCcsSmbaDhsxekaDcefhsaD8SbbglcFeGhPdnalcu9kmbaDcvfhOaPcFbGhPcrhldninas8SbbgDcFbGaltaPVhPaDcu9kmeascefhsalcrfglc8J9hmbkaOhsxekascefhskaPce4cbaPceG9R7amfgmhOkdndnaAcsSmbashlxekascefhlas8SbbgDcFeGhPdnaDcu9kmbascvfhzaPcFbGhPcrhDdninal8SbbgscFbGaDtaPVhPascu9kmealcefhlaDcrfgDc8J9hmbkazhlxekalcefhlkaPce4cbaPceG9R7amfgmhzkdndnadcd9hmbabarcetfgDaH87ebaDclfaz87ebaDcdfaO87ebxekabarcdtfgDaHBdbaDcwfazBdbaDclfaOBdbkavc;abfaocitfgDaOBdbaDaHBdlavaicdtfaHBdbavc;abfaocefcsGcitfgDazBdbaDaOBdlavaicefgicsGcdtfaOBdbavc;abfaocdfcsGcitfgDaHBdbaDazBdlavaiaCTaCcsSVfgicsGcdtfazBdbaiaATaAcsSVfhiaocifhokawcefhwaocsGhoaicsGhiarcifgrae6mbkkcbc99alaqSEhokavc;aef8Kjjjjbaok:clevu8Jjjjjbcz9Rhvdnalaecvf9pmbc9:skdnaiRbbc;:eGc;qeSmbcuskav9cb83iwaicefhoaialfc98fhrdnaeTmbdnadcdSmbcbhwindnaoar6mbc9:skaocefhlao8SbbgicFeGhddndnaicu9mmbalhoxekaocvfhoadcFbGhdcrhidninal8SbbgDcFbGaitadVhdaDcu9kmealcefhlaicrfgic8J9hmbxdkkalcefhokabawcdtfadc8Etc8F91adcd47avcwfadceGcdtVglydbfgiBdbalaiBdbawcefgwae9hmbxdkkcbhwindnaoar6mbc9:skaocefhlao8SbbgicFeGhddndnaicu9mmbalhoxekaocvfhoadcFbGhdcrhidninal8SbbgDcFbGaitadVhdaDcu9kmealcefhlaicrfgic8J9hmbxdkkalcefhokabawcetfadc8Etc8F91adcd47avcwfadceGcdtVglydbfgi87ebalaiBdbawcefgwae9hmbkkcbc99aoarSEk:Lvoeue99dud99eud99dndnadcl9hmbaeTmeindndnabcdfgd8Sbb:Yab8Sbbgi:Ygl:l:tabcefgv8Sbbgo:Ygr:l:tgwJbb;:9cawawNJbbbbawawJbbbb9GgDEgq:mgkaqaicb9iEalMgwawNakaqaocb9iEarMgqaqNMM:r:vglNJbbbZJbbb:;aDEMgr:lJbbb9p9DTmbar:Ohixekcjjjj94hikadai86bbdndnaqalNJbbbZJbbb:;aqJbbbb9GEMgq:lJbbb9p9DTmbaq:Ohdxekcjjjj94hdkavad86bbdndnawalNJbbbZJbbb:;awJbbbb9GEMgw:lJbbb9p9DTmbaw:Ohdxekcjjjj94hdkabad86bbabclfhbaecufgembxdkkaeTmbindndnabclfgd8Ueb:Yab8Uebgi:Ygl:l:tabcdfgv8Uebgo:Ygr:l:tgwJb;:FSawawNJbbbbawawJbbbb9GgDEgq:mgkaqaicb9iEalMgwawNakaqaocb9iEarMgqaqNMM:r:vglNJbbbZJbbb:;aDEMgr:lJbbb9p9DTmbar:Ohixekcjjjj94hikadai87ebdndnaqalNJbbbZJbbb:;aqJbbbb9GEMgq:lJbbb9p9DTmbaq:Ohdxekcjjjj94hdkavad87ebdndnawalNJbbbZJbbb:;awJbbbb9GEMgw:lJbbb9p9DTmbaw:Ohdxekcjjjj94hdkabad87ebabcwfhbaecufgembkkk:4ioiue99dud99dud99dnaeTmbcbhiabhlindndnal8Uebgv:YgoJ:ji:1Salcof8UebgrciVgw:Y:vgDNJbbbZJbbb:;avcu9kEMgq:lJbbb9p9DTmbaq:Ohkxekcjjjj94hkkalclf8Uebhvalcdf8UebhxalarcefciGcetfak87ebdndnax:YgqaDNJbbbZJbbb:;axcu9kEMgm:lJbbb9p9DTmbam:Ohxxekcjjjj94hxkabaiarciGgkfcd7cetfax87ebdndnav:YgmaDNJbbbZJbbb:;avcu9kEMgP:lJbbb9p9DTmbaP:Ohvxekcjjjj94hvkalarcufciGcetfav87ebdndnawaw2:ZgPaPMaoaoN:taqaqN:tamamN:tgoJbbbbaoJbbbb9GE:raDNJbbbZMgD:lJbbb9p9DTmbaD:Ohrxekcjjjj94hrkalakcetfar87ebalcwfhlaiclfhiaecufgembkkk9mbdnadcd4ae2gdTmbinababydbgecwtcw91:Yaece91cjjj98Gcjjj;8if::NUdbabclfhbadcufgdmbkkk:Tvirud99eudndnadcl9hmbaeTmeindndnabRbbgiabcefgl8Sbbgvabcdfgo8Sbbgrf9R:YJbbuJabcifgwRbbgdce4adVgDcd4aDVgDcl4aDVgD:Z:vgqNJbbbZMgk:lJbbb9p9DTmbak:Ohxxekcjjjj94hxkaoax86bbdndnaraif:YaqNJbbbZMgk:lJbbb9p9DTmbak:Ohoxekcjjjj94hokalao86bbdndnavaifar9R:YaqNJbbbZMgk:lJbbb9p9DTmbak:Ohixekcjjjj94hikabai86bbdndnaDadcetGadceGV:ZaqNJbbbZMgq:lJbbb9p9DTmbaq:Ohdxekcjjjj94hdkawad86bbabclfhbaecufgembxdkkaeTmbindndnab8Vebgiabcdfgl8Uebgvabclfgo8Uebgrf9R:YJbFu9habcofgw8Vebgdce4adVgDcd4aDVgDcl4aDVgDcw4aDVgD:Z:vgqNJbbbZMgk:lJbbb9p9DTmbak:Ohxxekcjjjj94hxkaoax87ebdndnaraif:YaqNJbbbZMgk:lJbbb9p9DTmbak:Ohoxekcjjjj94hokalao87ebdndnavaifar9R:YaqNJbbbZMgk:lJbbb9p9DTmbak:Ohixekcjjjj94hikabai87ebdndnaDadcetGadceGV:ZaqNJbbbZMgq:lJbbb9p9DTmbaq:Ohdxekcjjjj94hdkawad87ebabcwfhbaecufgembkkk9teiucbcbyd:K:G:cjbgeabcifc98GfgbBd:K:G:cjbdndnabZbcztgd9nmbcuhiabad9RcFFifcz4nbcuSmekaehikaik;LeeeudndnaeabVciGTmbabhixekdndnadcz9pmbabhixekabhiinaiaeydbBdbaiclfaeclfydbBdbaicwfaecwfydbBdbaicxfaecxfydbBdbaeczfheaiczfhiadc9Wfgdcs0mbkkadcl6mbinaiaeydbBdbaeclfheaiclfhiadc98fgdci0mbkkdnadTmbinaiaeRbb86bbaicefhiaecefheadcufgdmbkkabk;aeedudndnabciGTmbabhixekaecFeGc:b:c:ew2hldndnadcz9pmbabhixekabhiinaialBdbaicxfalBdbaicwfalBdbaiclfalBdbaiczfhiadc9Wfgdcs0mbkkadcl6mbinaialBdbaiclfhiadc98fgdci0mbkkdnadTmbinaiae86bbaicefhiadcufgdmbkkabkk83dbcj:Gdk8Kbbbbdbbblbbbwbbbbbbbebbbdbbblbbbwbbbbc:K:Gdkl8W:qbb",e="b9H79TebbbeKl9Gbb9Gvuuuuueu9Giuuub9Geueuixkbbebeeddddilve9Weeeviebeoweuecj:Gdkr;Neqo9TW9T9VV95dbH9F9F939H79T9F9J9H229F9Jt9VV7bb8A9TW79O9V9Wt9F9KW9J9V9KW9wWVtW949c919M9MWVbdY9TW79O9V9Wt9F9KW9J9V9KW69U9KW949c919M9MWVblE9TW79O9V9Wt9F9KW9J9V9KW69U9KW949tWG91W9U9JWbvL9TW79O9V9Wt9F9KW9J9V9KWS9P2tWV9p9JtboK9TW79O9V9Wt9F9KW9J9V9KWS9P2tWV9r919HtbrL9TW79O9V9Wt9F9KW9J9V9KWS9P2tWVT949WbwY9TW79O9V9Wt9F9KW9J9V9KWS9P2tWVJ9V29VVbDl79IV9Rbqq:W9Dklbzik94evu8Jjjjjbcz9Rhbcbheincbhdcbhiinabcwfadfaicjuaead4ceGglE86bbaialfhiadcefgdcw9hmbkaeai86b:q:W:cjbaecitab8Piw83i:q:G:cjbaecefgecjd9hmbkk:JBl8Aud97dur978Jjjjjbcj;kb9Rgv8Kjjjjbc9:hodnalTmbcuhoaiRbbgrc;WeGc:Ge9hmbarcsGgwce0mbc9:hoalcufadcd4cbawEgDadfgrcKcaawEgqaraq0Egk6mbaialfgxar9RhodnadTgmmbavaoad;8qbbkaicefhPcj;abad9Uc;WFbGcjdadca0EhsdndndnadTmbaoadfhzcbhHinaeaH9nmdaxaP9RaD6miabaHad2fhOaPaDfhAasaeaH9RaHasfae6EgCcsfgocl4cifcd4hXavcj;cbfaoc9WGgQcetfhLavcj;cbfaQci2fhKavcj;cbfaQfhYcbh8Aaoc;ab6hEincbh3dnawTmbaPa8Acd4fRbbh3kcbh5avcj;cbfh8Eindndndndna3a5cet4ciGgoc9:fPdebdkaxaA9RaQ6mwdnaQTmbavcj;cbfa5aQ2faAaQ;8qbbkaAaCfhAxdkaQTmeavcj;cbfa5aQ2fcbaQ;8kbxekaxaA9RaX6moaoclVcbawEhraAaXfhocbhidnaEmbaxao9Rc;Gb6mbcbhlina8EalfhidndndndndndnaAalco4fRbbgqciGarfPDbedibledibkaipxbbbbbbbbbbbbbbbbpklbxlkaiaopbblaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLg8Fcdp:mea8FpmbzeHdOiAlCvXoQrLpxiiiiiiiiiiiiiiiip9ogapxiiiiiiiiiiiiiiiip8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Nghcitpbi:q:G:cjbahRb:q:W:cjbghpsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Nggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spklbahaoclffagRb:q:W:cjbfhoxikaiaopbbwaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLpxssssssssssssssssp9ogapxssssssssssssssssp8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Nghcitpbi:q:G:cjbahRb:q:W:cjbghpsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Nggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spklbahaocwffagRb:q:W:cjbfhoxdkaiaopbbbpklbaoczfhoxekaiaopbbdaoRbbghcitpbi:q:G:cjbahRb:q:W:cjbghpsaoRbeggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPpklbahaocdffagRb:q:W:cjbfhokdndndndndndnaqcd4ciGarfPDbedibledibkaiczfpxbbbbbbbbbbbbbbbbpklbxlkaiczfaopbblaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLg8Fcdp:mea8FpmbzeHdOiAlCvXoQrLpxiiiiiiiiiiiiiiiip9ogapxiiiiiiiiiiiiiiiip8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Nghcitpbi:q:G:cjbahRb:q:W:cjbghpsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Nggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spklbahaoclffagRb:q:W:cjbfhoxikaiczfaopbbwaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLpxssssssssssssssssp9ogapxssssssssssssssssp8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Nghcitpbi:q:G:cjbahRb:q:W:cjbghpsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Nggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spklbahaocwffagRb:q:W:cjbfhoxdkaiczfaopbbbpklbaoczfhoxekaiczfaopbbdaoRbbghcitpbi:q:G:cjbahRb:q:W:cjbghpsaoRbeggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPpklbahaocdffagRb:q:W:cjbfhokdndndndndndnaqcl4ciGarfPDbedibledibkaicafpxbbbbbbbbbbbbbbbbpklbxlkaicafaopbblaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLg8Fcdp:mea8FpmbzeHdOiAlCvXoQrLpxiiiiiiiiiiiiiiiip9ogapxiiiiiiiiiiiiiiiip8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Nghcitpbi:q:G:cjbahRb:q:W:cjbghpsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Nggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spklbahaoclffagRb:q:W:cjbfhoxikaicafaopbbwaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLpxssssssssssssssssp9ogapxssssssssssssssssp8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Nghcitpbi:q:G:cjbahRb:q:W:cjbghpsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Nggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spklbahaocwffagRb:q:W:cjbfhoxdkaicafaopbbbpklbaoczfhoxekaicafaopbbdaoRbbghcitpbi:q:G:cjbahRb:q:W:cjbghpsaoRbeggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPpklbahaocdffagRb:q:W:cjbfhokdndndndndndnaqco4arfPDbedibledibkaic8Wfpxbbbbbbbbbbbbbbbbpklbxlkaic8Wfaopbblaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLg8Fcdp:mea8FpmbzeHdOiAlCvXoQrLpxiiiiiiiiiiiiiiiip9ogapxiiiiiiiiiiiiiiiip8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Ngicitpbi:q:G:cjbaiRb:q:W:cjbgipsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Ngqcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spklbaiaoclffaqRb:q:W:cjbfhoxikaic8Wfaopbbwaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLpxssssssssssssssssp9ogapxssssssssssssssssp8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Ngicitpbi:q:G:cjbaiRb:q:W:cjbgipsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Ngqcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spklbaiaocwffaqRb:q:W:cjbfhoxdkaic8Wfaopbbbpklbaoczfhoxekaic8WfaopbbdaoRbbgicitpbi:q:G:cjbaiRb:q:W:cjbgipsaoRbegqcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPpklbaiaocdffaqRb:q:W:cjbfhokalc;abfhialcjefaQ0meaihlaxao9Rc;Fb0mbkkdnaiaQ9pmbaici4hlinaxao9RcK6mwa8EaifhqdndndndndndnaAaico4fRbbalcoG4ciGarfPDbedibledibkaqpxbbbbbbbbbbbbbbbbpkbbxlkaqaopbblaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLg8Fcdp:mea8FpmbzeHdOiAlCvXoQrLpxiiiiiiiiiiiiiiiip9ogapxiiiiiiiiiiiiiiiip8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Nghcitpbi:q:G:cjbahRb:q:W:cjbghpsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Nggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spkbbahaoclffagRb:q:W:cjbfhoxikaqaopbbwaopbbbg8Fclp:mea8FpmbzeHdOiAlCvXoQrLpxssssssssssssssssp9ogapxssssssssssssssssp8Jg8Fp5b9cjF;8;4;W;G;ab9:9cU1:Nghcitpbi:q:G:cjbahRb:q:W:cjbghpsa8Fp5e9cjF;8;4;W;G;ab9:9cU1:Nggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPaaa8Fp9spkbbahaocwffagRb:q:W:cjbfhoxdkaqaopbbbpkbbaoczfhoxekaqaopbbdaoRbbghcitpbi:q:G:cjbahRb:q:W:cjbghpsaoRbeggcitpbi:q:G:cjbp9UpmbedilvorzHOACXQLpPpkbbahaocdffagRb:q:W:cjbfhokalcdfhlaiczfgiaQ6mbkkaohAaoTmoka8EaQfh8Ea5cefg5cl9hmbkdndndndnawTmbaza8Acd4fRbbglciGPlbedwbkaQTmdavcjdfa8Afhlava8Afpbdbh8Jcbhoinalavcj;cbfaofpblbg8KaYaofpblbg8LpmbzeHdOiAlCvXoQrLg8MaLaofpblbg8NaKaofpblbgypmbzeHdOiAlCvXoQrLg8PpmbezHdiOAlvCXorQLg8Fcep9Ta8Fpxeeeeeeeeeeeeeeeegap9op9Hp9rg8Fa8Jp9Ug8Jp9Abbbaladfgla8Ja8Fa8Fpmlvorlvorlvorlvorp9Ug8Jp9Abbbaladfgla8Ja8Fa8FpmwDqkwDqkwDqkwDqkp9Ug8Jp9Abbbaladfgla8Ja8Fa8FpmxmPsxmPsxmPsxmPsp9Ug8Jp9Abbbaladfgla8Ja8Ma8PpmwDKYqk8AExm35Ps8E8Fg8Fcep9Ta8Faap9op9Hp9rg8Fp9Ug8Jp9Abbbaladfgla8Ja8Fa8Fpmlvorlvorlvorlvorp9Ug8Jp9Abbbaladfgla8Ja8Fa8FpmwDqkwDqkwDqkwDqkp9Ug8Jp9Abbbaladfgla8Ja8Fa8FpmxmPsxmPsxmPsxmPsp9Ug8Jp9Abbbaladfgla8Ja8Ka8LpmwKDYq8AkEx3m5P8Es8Fg8Ka8NaypmwKDYq8AkEx3m5P8Es8Fg8LpmbezHdiOAlvCXorQLg8Fcep9Ta8Faap9op9Hp9rg8Fp9Ug8Jp9Abbbaladfgla8Ja8Fa8Fpmlvorlvorlvorlvorp9Ug8Jp9Abbbaladfgla8Ja8Fa8FpmwDqkwDqkwDqkwDqkp9Ug8Jp9Abbbaladfgla8Ja8Fa8FpmxmPsxmPsxmPsxmPsp9Ug8Jp9Abbbaladfgla8Ja8Ka8LpmwDKYqk8AExm35Ps8E8Fg8Fcep9Ta8Faap9op9Hp9rg8Fp9Ugap9Abbbaladfglaaa8Fa8Fpmlvorlvorlvorlvorp9Ugap9Abbbaladfglaaa8Fa8FpmwDqkwDqkwDqkwDqkp9Ugap9Abbbaladfglaaa8Fa8FpmxmPsxmPsxmPsxmPsp9Ug8Jp9AbbbaladfhlaoczfgoaQ6mbxikkaQTmeavcjdfa8Afhlava8Afpbdbh8Jcbhoinalavcj;cbfaofpblbg8KaYaofpblbg8LpmbzeHdOiAlCvXoQrLg8MaLaofpblbg8NaKaofpblbgypmbzeHdOiAlCvXoQrLg8PpmbezHdiOAlvCXorQLg8Fcep:nea8Fpxebebebebebebebebgap9op:bep9rg8Fa8Jp:oeg8Jp9Abbbaladfgla8Ja8Fa8Fpmlvorlvorlvorlvorp:oeg8Jp9Abbbaladfgla8Ja8Fa8FpmwDqkwDqkwDqkwDqkp:oeg8Jp9Abbbaladfgla8Ja8Fa8FpmxmPsxmPsxmPsxmPsp:oeg8Jp9Abbbaladfgla8Ja8Ma8PpmwDKYqk8AExm35Ps8E8Fg8Fcep:nea8Faap9op:bep9rg8Fp:oeg8Jp9Abbbaladfgla8Ja8Fa8Fpmlvorlvorlvorlvorp:oeg8Jp9Abbbaladfgla8Ja8Fa8FpmwDqkwDqkwDqkwDqkp:oeg8Jp9Abbbaladfgla8Ja8Fa8FpmxmPsxmPsxmPsxmPsp:oeg8Jp9Abbbaladfgla8Ja8Ka8LpmwKDYq8AkEx3m5P8Es8Fg8Ka8NaypmwKDYq8AkEx3m5P8Es8Fg8LpmbezHdiOAlvCXorQLg8Fcep:nea8Faap9op:bep9rg8Fp:oeg8Jp9Abbbaladfgla8Ja8Fa8Fpmlvorlvorlvorlvorp:oeg8Jp9Abbbaladfgla8Ja8Fa8FpmwDqkwDqkwDqkwDqkp:oeg8Jp9Abbbaladfgla8Ja8Fa8FpmxmPsxmPsxmPsxmPsp:oeg8Jp9Abbbaladfgla8Ja8Ka8LpmwDKYqk8AExm35Ps8E8Fg8Fcep:nea8Faap9op:bep9rg8Fp:oegap9Abbbaladfglaaa8Fa8Fpmlvorlvorlvorlvorp:oegap9Abbbaladfglaaa8Fa8FpmwDqkwDqkwDqkwDqkp:oegap9Abbbaladfglaaa8Fa8FpmxmPsxmPsxmPsxmPsp:oeg8Jp9AbbbaladfhlaoczfgoaQ6mbxdkkaQTmbcbhocbalcl4gl9Rc8FGhiavcjdfa8Afhrava8Afpbdbhainaravcj;cbfaofpblbg8JaYaofpblbg8KpmbzeHdOiAlCvXoQrLg8LaLaofpblbg8MaKaofpblbg8NpmbzeHdOiAlCvXoQrLgypmbezHdiOAlvCXorQLg8Faip:Rea8Falp:Tep9qg8Faap9rgap9Abbbaradfgraaa8Fa8Fpmlvorlvorlvorlvorp9rgap9Abbbaradfgraaa8Fa8FpmwDqkwDqkwDqkwDqkp9rgap9Abbbaradfgraaa8Fa8FpmxmPsxmPsxmPsxmPsp9rgap9Abbbaradfgraaa8LaypmwDKYqk8AExm35Ps8E8Fg8Faip:Rea8Falp:Tep9qg8Fp9rgap9Abbbaradfgraaa8Fa8Fpmlvorlvorlvorlvorp9rgap9Abbbaradfgraaa8Fa8FpmwDqkwDqkwDqkwDqkp9rgap9Abbbaradfgraaa8Fa8FpmxmPsxmPsxmPsxmPsp9rgap9Abbbaradfgraaa8Ja8KpmwKDYq8AkEx3m5P8Es8Fg8Ja8Ma8NpmwKDYq8AkEx3m5P8Es8Fg8KpmbezHdiOAlvCXorQLg8Faip:Rea8Falp:Tep9qg8Fp9rgap9Abbbaradfgraaa8Fa8Fpmlvorlvorlvorlvorp9rgap9Abbbaradfgraaa8Fa8FpmwDqkwDqkwDqkwDqkp9rgap9Abbbaradfgraaa8Fa8FpmxmPsxmPsxmPsxmPsp9rgap9Abbbaradfgraaa8Ja8KpmwDKYqk8AExm35Ps8E8Fg8Faip:Rea8Falp:Tep9qg8Fp9rgap9Abbbaradfgraaa8Fa8Fpmlvorlvorlvorlvorp9rgap9Abbbaradfgraaa8Fa8FpmwDqkwDqkwDqkwDqkp9rgap9Abbbaradfgraaa8Fa8FpmxmPsxmPsxmPsxmPsp9rgap9AbbbaradfhraoczfgoaQ6mbkka8Aclfg8Aad6mbkdnaCad2goTmbaOavcjdfao;8qbbkdnammbavavcjdfaCcufad2fad;8qbbkaCaHfhHc9:hoaAhPaAmbxlkkaeTmbaDalfhrcbhocuhlinaralaD9RglfaD6mdasaeao9Raoasfae6Eaofgoae6mbkaial9RhPkcbc99axaP9RakSEhoxekc9:hokavcj;kbf8Kjjjjbaokwbz:bjjjbkNsezu8Jjjjjbc;ae9Rgv8Kjjjjbc9:hodnalaeci9UgrcHf6mbcuhoaiRbbgwc;WeGc;Ge9hmbawcsGgDce0mbavc;abfcFecje;8kbav9cu83iUav9cu83i8Wav9cu83iyav9cu83iaav9cu83iKav9cu83izav9cu83iwav9cu83ibaialfc9WfhqaicefgwarfhldnaeTmbcmcsaDceSEhkcbhxcbhmcbhrcbhicbhoindnalaq9nmbc9:hoxikdndnawRbbgDc;Ve0mbavc;abfaoaDcu7gPcl4fcsGcitfgsydlhzasydbhHdndnaDcsGgsak9pmbavaiaPfcsGcdtfydbaxasEhDaxasTgOfhxxekdndnascsSmbcehOasc987asamffcefhDxekalcefhDal8SbbgscFeGhPdndnascu9mmbaDhlxekalcvfhlaPcFbGhPcrhsdninaD8SbbgOcFbGastaPVhPaOcu9kmeaDcefhDascrfgsc8J9hmbxdkkaDcefhlkcehOaPce4cbaPceG9R7amfhDkaDhmkavc;abfaocitfgsaDBdbasazBdlavaicdtfaDBdbavc;abfaocefcsGcitfgsaHBdbasaDBdlaocdfhoaOaifhidnadcd9hmbabarcetfgsaH87ebasclfaD87ebascdfaz87ebxdkabarcdtfgsaHBdbascwfaDBdbasclfazBdbxekdnaDcpe0mbavaiaqaDcsGfRbbgscl4gP9RcsGcdtfydbaxcefgOaPEhDavaias9RcsGcdtfydbaOaPTgzfgOascsGgPEhsaPThPdndnadcd9hmbabarcetfgHax87ebaHclfas87ebaHcdfaD87ebxekabarcdtfgHaxBdbaHcwfasBdbaHclfaDBdbkavaicdtfaxBdbavc;abfaocitfgHaDBdbaHaxBdlavaicefgicsGcdtfaDBdbavc;abfaocefcsGcitfgHasBdbaHaDBdlavaiazfgicsGcdtfasBdbavc;abfaocdfcsGcitfgDaxBdbaDasBdlaocifhoaiaPfhiaOaPfhxxekaxcbalRbbgsEgHaDc;:eSgDfhOascsGhAdndnascl4gCmbaOcefhzxekaOhzavaiaC9RcsGcdtfydbhOkdndnaAmbazcefhxxekazhxavaias9RcsGcdtfydbhzkdndnaDTmbalcefhDxekalcdfhDal8SbegPcFeGhsdnaPcu9kmbalcofhHascFbGhscrhldninaD8SbbgPcFbGaltasVhsaPcu9kmeaDcefhDalcrfglc8J9hmbkaHhDxekaDcefhDkasce4cbasceG9R7amfgmhHkdndnaCcsSmbaDhsxekaDcefhsaD8SbbglcFeGhPdnalcu9kmbaDcvfhOaPcFbGhPcrhldninas8SbbgDcFbGaltaPVhPaDcu9kmeascefhsalcrfglc8J9hmbkaOhsxekascefhskaPce4cbaPceG9R7amfgmhOkdndnaAcsSmbashlxekascefhlas8SbbgDcFeGhPdnaDcu9kmbascvfhzaPcFbGhPcrhDdninal8SbbgscFbGaDtaPVhPascu9kmealcefhlaDcrfgDc8J9hmbkazhlxekalcefhlkaPce4cbaPceG9R7amfgmhzkdndnadcd9hmbabarcetfgDaH87ebaDclfaz87ebaDcdfaO87ebxekabarcdtfgDaHBdbaDcwfazBdbaDclfaOBdbkavc;abfaocitfgDaOBdbaDaHBdlavaicdtfaHBdbavc;abfaocefcsGcitfgDazBdbaDaOBdlavaicefgicsGcdtfaOBdbavc;abfaocdfcsGcitfgDaHBdbaDazBdlavaiaCTaCcsSVfgicsGcdtfazBdbaiaATaAcsSVfhiaocifhokawcefhwaocsGhoaicsGhiarcifgrae6mbkkcbc99alaqSEhokavc;aef8Kjjjjbaok:clevu8Jjjjjbcz9Rhvdnalaecvf9pmbc9:skdnaiRbbc;:eGc;qeSmbcuskav9cb83iwaicefhoaialfc98fhrdnaeTmbdnadcdSmbcbhwindnaoar6mbc9:skaocefhlao8SbbgicFeGhddndnaicu9mmbalhoxekaocvfhoadcFbGhdcrhidninal8SbbgDcFbGaitadVhdaDcu9kmealcefhlaicrfgic8J9hmbxdkkalcefhokabawcdtfadc8Etc8F91adcd47avcwfadceGcdtVglydbfgiBdbalaiBdbawcefgwae9hmbxdkkcbhwindnaoar6mbc9:skaocefhlao8SbbgicFeGhddndnaicu9mmbalhoxekaocvfhoadcFbGhdcrhidninal8SbbgDcFbGaitadVhdaDcu9kmealcefhlaicrfgic8J9hmbxdkkalcefhokabawcetfadc8Etc8F91adcd47avcwfadceGcdtVglydbfgi87ebalaiBdbawcefgwae9hmbkkcbc99aoarSEk;Toio97eue97aec98Ghedndnadcl9hmbaeTmecbhdinababpbbbgicKp:RecKp:Sep;6eglaicwp:RecKp:Sep;6ealp;Geaiczp:RecKp:Sep;6egvp;Gep;Kep;Legopxbbbbbbbbbbbbbbbbp:2egralpxbbbjbbbjbbbjbbbjgwp9op9rp;Keglpxbb;:9cbb;:9cbb;:9cbb;:9calalp;Meaoaop;Meavaravawp9op9rp;Keglalp;Mep;Kep;Kep;Jep;Negvp;Mepxbbn0bbn0bbn0bbn0grp;KepxFbbbFbbbFbbbFbbbp9oaipxbbbFbbbFbbbFbbbFp9op9qalavp;Mearp;Kecwp:RepxbFbbbFbbbFbbbFbbp9op9qaoavp;Mearp;Keczp:RepxbbFbbbFbbbFbbbFbp9op9qpkbbabczfhbadclfgdae6mbxdkkaeTmbcbhdinabczfgDaDpbbbgipxbbbbbbFFbbbbbbFFgwp9oabpbbbgoaipmbediwDqkzHOAKY8AEgvczp:Reczp:Sep;6eglaoaipmlvorxmPsCXQL358E8FpxFubbFubbFubbFubbp9op;6eavczp:Sep;6egvp;Gealp;Gep;Kep;Legipxbbbbbbbbbbbbbbbbp:2egralpxbbbjbbbjbbbjbbbjgqp9op9rp;Keglpxb;:FSb;:FSb;:FSb;:FSalalp;Meaiaip;Meavaravaqp9op9rp;Keglalp;Mep;Kep;Kep;Jep;Negvp;Mepxbbn0bbn0bbn0bbn0grp;KepxFFbbFFbbFFbbFFbbp9oaiavp;Mearp;Keczp:Rep9qgialavp;Mearp;KepxFFbbFFbbFFbbFFbbp9oglpmwDKYqk8AExm35Ps8E8Fp9qpkbbabaoawp9oaialpmbezHdiOAlvCXorQLp9qpkbbabcafhbadclfgdae6mbkkk;2ileue97euo97dnaec98GgiTmbcbheinabcKfpx:ji:1S:ji:1S:ji:1S:ji:1SabpbbbglabczfgvpbbbgopmlvorxmPsCXQL358E8Fgrczp:Segwpxibbbibbbibbbibbbp9qp;6egDp;NegqaDaDp;MegDaDp;KealaopmbediwDqkzHOAKY8AEgDczp:Reczp:Sep;6eglalp;MeaDczp:Sep;6egoaop;Mearczp:Reczp:Sep;6egrarp;Mep;Kep;Kep;Lepxbbbbbbbbbbbbbbbbp:4ep;Jep;Mepxbbn0bbn0bbn0bbn0gDp;KepxFFbbFFbbFFbbFFbbgkp9oaqaop;MeaDp;Keczp:Rep9qgoaqalp;MeaDp;Keakp9oaqarp;MeaDp;Keczp:Rep9qgDpmwDKYqk8AExm35Ps8E8Fglp5eawclp:RegqpEi:T:j83ibavalp5baqpEd:T:j83ibabcwfaoaDpmbezHdiOAlvCXorQLgDp5eaqpEe:T:j83ibabaDp5baqpEb:T:j83ibabcafhbaeclfgeai6mbkkkuee97dnadcd4ae2c98GgeTmbcbhdinababpbbbgicwp:Recwp:Sep;6eaicep:SepxbbjFbbjFbbjFbbjFp9opxbbjZbbjZbbjZbbjZp:Uep;Mepkbbabczfhbadclfgdae6mbkkk:Sodw97euaec98Ghedndnadcl9hmbaeTmecbhdinabpxbbuJbbuJbbuJbbuJabpbbbgicKp:TeglaicYp:Tep9qgvcdp:Teavp9qgvclp:Teavp9qgop;6ep;Negvaicwp:RecKp:SegraipxFbbbFbbbFbbbFbbbgwp9ogDp:Uep;6ep;Mepxbbn0bbn0bbn0bbn0gqp;Kecwp:RepxbFbbbFbbbFbbbFbbp9oavaDarp:Xeaiczp:RecKp:Segip:Uep;6ep;Meaqp;Keawp9op9qavaDaraip:Uep:Xep;6ep;Meaqp;Keczp:RepxbbFbbbFbbbFbbbFbp9op9qavaoalcep:Rep9oalpxebbbebbbebbbebbbp9op9qp;6ep;Meaqp;KecKp:Rep9qpkbbabczfhbadclfgdae6mbxdkkaeTmbcbhdinabczfgkpxbFu9hbFu9hbFu9hbFu9habpbbbglakpbbbgrpmlvorxmPsCXQL358E8Fgvczp:TegqavcHp:Tep9qgicdp:Teaip9qgiclp:Teaip9qgicwp:Teaip9qgop;6ep;NegialarpmbediwDqkzHOAKY8AEgDpxFFbbFFbbFFbbFFbbglp9ograDczp:Segwp:Ueavczp:Reczp:SegDp:Xep;6ep;Mepxbbn0bbn0bbn0bbn0gvp;Kealp9oaiarawaDp:Uep:Xep;6ep;Meavp;Keczp:Rep9qgwaiaoaqcep:Rep9oaqpxebbbebbbebbbebbbp9op9qp;6ep;Meavp;Keczp:ReaiaDarp:Uep;6ep;Meavp;Kealp9op9qgipmwDKYqk8AExm35Ps8E8FpkbbabawaipmbezHdiOAlvCXorQLpkbbabcafhbadclfgdae6mbkkk9teiucbcbydj:G:cjbgeabcifc98GfgbBdj:G:cjbdndnabZbcztgd9nmbcuhiabad9RcFFifcz4nbcuSmekaehikaikkxebcj:Gdklz:zbb",t=new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,3,2,0,0,5,3,1,0,1,12,1,0,10,22,2,12,0,65,0,65,0,65,0,252,10,0,0,11,7,0,65,0,253,15,26,11]),n=new Uint8Array([32,0,65,2,1,106,34,33,3,128,11,4,13,64,6,253,10,7,15,116,127,5,8,12,40,16,19,54,20,9,27,255,113,17,42,67,24,23,146,148,18,14,22,45,70,69,56,114,101,21,25,63,75,136,108,28,118,29,73,115]);if(typeof WebAssembly!="object")return{supported:!1};var s=WebAssembly.validate(t)?o(e):o(i),r,a=WebAssembly.instantiate(s,{}).then(function(p){r=p.instance,r.exports.__wasm_call_ctors()});function o(p){for(var x=new Uint8Array(p.length),y=0;y<p.length;++y){var w=p.charCodeAt(y);x[y]=w>96?w-97:w>64?w-39:w+4}for(var A=0,y=0;y<p.length;++y)x[A++]=x[y]<60?n[x[y]]:(x[y]-60)*64+x[++y];return x.buffer.slice(0,A)}function c(p,x,y,w,A,S,R){var b=p.exports.sbrk,T=w+3&-4,P=b(T*A),C=b(S.length),N=new Uint8Array(p.exports.memory.buffer);N.set(S,C);var G=x(P,w,A,C,S.length);if(G==0&&R&&R(P,T,A),y.set(N.subarray(P,P+w*A)),b(P-b(0)),G!=0)throw new Error("Malformed buffer data: "+G)}var l={NONE:"",OCTAHEDRAL:"meshopt_decodeFilterOct",QUATERNION:"meshopt_decodeFilterQuat",EXPONENTIAL:"meshopt_decodeFilterExp",COLOR:"meshopt_decodeFilterColor"},h={ATTRIBUTES:"meshopt_decodeVertexBuffer",TRIANGLES:"meshopt_decodeIndexBuffer",INDICES:"meshopt_decodeIndexSequence"},u=[],d=0;function f(p){var x={object:new Worker(p),pending:0,requests:{}};return x.object.onmessage=function(y){var w=y.data;x.pending-=w.count,x.requests[w.id][w.action](w.value),delete x.requests[w.id]},x}function g(p){for(var x="self.ready = WebAssembly.instantiate(new Uint8Array(["+new Uint8Array(s)+"]), {}).then(function(result) { result.instance.exports.__wasm_call_ctors(); return result.instance; });self.onmessage = "+m.name+";"+c.toString()+m.toString(),y=new Blob([x],{type:"text/javascript"}),w=URL.createObjectURL(y),A=u.length;A<p;++A)u[A]=f(w);for(var A=p;A<u.length;++A)u[A].object.postMessage({});u.length=p,URL.revokeObjectURL(w)}function _(p,x,y,w,A){for(var S=u[0],R=1;R<u.length;++R)u[R].pending<S.pending&&(S=u[R]);return new Promise(function(b,T){var P=new Uint8Array(y),C=++d;S.pending+=p,S.requests[C]={resolve:b,reject:T},S.object.postMessage({id:C,count:p,size:x,source:P,mode:w,filter:A},[P.buffer])})}function m(p){var x=p.data;self.ready.then(function(y){if(!x.id)return self.close();try{var w=new Uint8Array(x.count*x.size);c(y,y.exports[x.mode],w,x.count,x.size,x.source,y.exports[x.filter]),self.postMessage({id:x.id,count:x.count,action:"resolve",value:w},[w.buffer])}catch(A){self.postMessage({id:x.id,count:x.count,action:"reject",value:A})}})}return{ready:a,supported:!0,useWorkers:function(p){g(p)},decodeVertexBuffer:function(p,x,y,w,A){c(r,r.exports.meshopt_decodeVertexBuffer,p,x,y,w,r.exports[l[A]])},decodeIndexBuffer:function(p,x,y,w){c(r,r.exports.meshopt_decodeIndexBuffer,p,x,y,w)},decodeIndexSequence:function(p,x,y,w){c(r,r.exports.meshopt_decodeIndexSequence,p,x,y,w)},decodeGltfBuffer:function(p,x,y,w,A,S){c(r,r.exports[h[A]],p,x,y,w,r.exports[l[S]])},decodeGltfBufferAsync:function(p,x,y,w,A){return u.length>0?_(p,x,y,h[w],l[A]):a.then(function(){var S=new Uint8Array(p*x);return c(r,r.exports[h[w]],S,p,x,y,r.exports[l[A]]),S})}}})()});function Rp(){return zc||(zc=Promise.resolve().then(()=>(Tp(),Ep)).then(i=>i.MeshoptDecoder),zc)}var zc,Cp=ct(()=>{"use strict";zc=null});function _n(i){if(typeof i!="string"||!i)return null;let e=Ru(i);if(e)return e;let t=i.replace(/_joint$/i,"");if(t!==i)return Ru(t);let n=i.replace(/[._]\d+$/,"");return n!==i?Ru(n):null}function Ru(i){let e=i;if(e=e.replace(/^(?:[A-Za-z][\w]*:)+/,""),e=e.replace(/^mixamorig\d*[_:]?/i,""),e=e.replace(/^Armature[_/]?/i,""),e=e.replace(/^(DEF|ORG|MCH)[-_]/i,""),e=e.replace(/^CH[_:]/i,""),e=e.replace(/^CC_Base_/i,""),/^spine01$/i.test(e))return"Spine";if(/^spine02$/i.test(e))return"Spine1";e=e.replace(/^j_(?!bip|sec|adj)/i,""),e=e.replace(/^\d+\./,"").replace(/^!/,"").replace(/^joint[_:]/i,""),e=e.replace(/^ValveBiped\.?/i,""),e=e.replace(/^Bip\d+[\s_]?/i,"");let t=e.replace(/[-_.\s]+/g,"").toLowerCase();return iw.get(t)??Cu.get(t)??sw.get(t)??null}function Ip(i,e={}){let t=typeof e.isAncestor=="function"?e.isAncestor:null,n=new Map;for(let o of i)n.set(o.canonical,(n.get(o.canonical)||0)+1);let s=(o,c,l)=>o.length<2||!t?o[0]:o.find(u=>c.some(d=>d!==u&&(l?t(u,d):t(d,u))))||o[0],r=(o,c,l)=>{o.canonical=l,n.set(c,(n.get(c)||1)-1),n.set(l,(n.get(l)||0)+1)},a=0;for(let o of["Left","Right"]){let c=`${o}Arm`,l=`${o}Shoulder`;if((n.get(c)||0)<2||(n.get(l)||0)>0)continue;let h=i.filter(g=>g.canonical===c),u=h.filter(g=>Lp.test(g.raw));if(u.length===0)continue;let d=h.filter(g=>rw.test(g.raw)&&!Lp.test(g.raw)),f=s(d,u,!0);f&&(r(f,c,l),a++)}for(let o of["Left","Right"]){let c=`${o}Arm`,l=`${o}Shoulder`;if((n.get(l)||0)<2||(n.get(c)||0)>0)continue;let h=i.filter(g=>g.canonical===l),u=h.filter(g=>Pp.test(g.raw));if(u.length===0)continue;let d=h.filter(g=>/shoulder/i.test(g.raw)&&!Pp.test(g.raw)),f=s(d,u,!1);f&&(r(f,l,c),a++)}return a}var nw,iw,Cu,sw,rw,Lp,Pp,Vc=ct(()=>{"use strict";nw=Object.freeze(["Hips","Spine","Spine1","Spine2","Neck","Head","LeftShoulder","LeftArm","LeftForeArm","LeftHand","LeftHandIndex1","LeftHandIndex2","LeftHandIndex3","LeftHandMiddle1","LeftHandMiddle2","LeftHandMiddle3","LeftHandPinky1","LeftHandPinky2","LeftHandPinky3","LeftHandRing1","LeftHandRing2","LeftHandRing3","LeftHandThumb1","LeftHandThumb2","LeftHandThumb3","RightShoulder","RightArm","RightForeArm","RightHand","RightHandIndex1","RightHandIndex2","RightHandIndex3","RightHandMiddle1","RightHandMiddle2","RightHandMiddle3","RightHandPinky1","RightHandPinky2","RightHandPinky3","RightHandRing1","RightHandRing2","RightHandRing3","RightHandThumb1","RightHandThumb2","RightHandThumb3","LeftUpLeg","LeftLeg","LeftFoot","LeftToeBase","RightUpLeg","RightLeg","RightFoot","RightToeBase"]),iw=(()=>{let i=new Map;for(let e of nw)i.set(e.toLowerCase(),e);return i})(),Cu=new Map(Object.entries({pelvis:"Hips",neck01:"Neck",claviclel:"LeftShoulder",upperarml:"LeftArm",lowerarml:"LeftForeArm",handl:"LeftHand",clavicler:"RightShoulder",upperarmr:"RightArm",lowerarmr:"RightForeArm",handr:"RightHand",thighl:"LeftUpLeg",calfl:"LeftLeg",footl:"LeftFoot",balll:"LeftToeBase",thighr:"RightUpLeg",calfr:"RightLeg",footr:"RightFoot",ballr:"RightToeBase"}));for(let[i,e]of[["thumb","Thumb"],["index","Index"],["middle","Middle"],["ring","Ring"],["pinky","Pinky"]])for(let t=1;t<=3;t++)Cu.set(`${i}0${t}l`,`LeftHand${e}${t}`),Cu.set(`${i}0${t}r`,`RightHand${e}${t}`);sw=(()=>{let i=new Map,e=r=>r.replace(/[-_.\s]+/g,"").toLowerCase(),t=(r,a)=>{let o=e(r);i.has(o)||i.set(o,a)},n=[["J_Bip_C_Hips","Hips"],["J_Bip_C_Spine","Spine"],["J_Bip_C_Chest","Spine1"],["J_Bip_C_UpperChest","Spine2"],["J_Bip_C_Neck","Neck"],["J_Bip_C_Head","Head"],["J_Bip_L_Shoulder","LeftShoulder"],["J_Bip_L_UpperArm","LeftArm"],["J_Bip_L_LowerArm","LeftForeArm"],["J_Bip_L_Hand","LeftHand"],["J_Bip_R_Shoulder","RightShoulder"],["J_Bip_R_UpperArm","RightArm"],["J_Bip_R_LowerArm","RightForeArm"],["J_Bip_R_Hand","RightHand"],["J_Bip_L_UpperLeg","LeftUpLeg"],["J_Bip_L_LowerLeg","LeftLeg"],["J_Bip_L_Foot","LeftFoot"],["J_Bip_L_ToeBase","LeftToeBase"],["J_Bip_L_Toes","LeftToeBase"],["J_Bip_R_UpperLeg","RightUpLeg"],["J_Bip_R_LowerLeg","RightLeg"],["J_Bip_R_Foot","RightFoot"],["J_Bip_R_ToeBase","RightToeBase"],["J_Bip_R_Toes","RightToeBase"]];for(let[r,a]of n)t(r,a);for(let[r,a]of[["Thumb","Thumb"],["Index","Index"],["Middle","Middle"],["Ring","Ring"],["Little","Pinky"]])for(let o=1;o<=3;o++)t(`J_Bip_L_${r}${o}`,`LeftHand${a}${o}`),t(`J_Bip_R_${r}${o}`,`RightHand${a}${o}`);for(let[r,a]of[["\u30BB\u30F3\u30BF\u30FC","Hips"],["\u4E0B\u534A\u8EAB","Hips"],["\u4E0A\u534A\u8EAB","Spine"],["\u4E0A\u534A\u8EAB2","Spine1"],["\u9996","Neck"],["\u982D","Head"]])t(r,a);for(let[r,a]of[["\u5DE6","Left"],["\u53F3","Right"]]){for(let[o,c]of[["\u80A9","Shoulder"],["\u8155","Arm"],["\u3072\u3058","ForeArm"],["\u624B\u9996","Hand"],["\u8DB3","UpLeg"],["\u3072\u3056","Leg"],["\u8DB3\u9996","Foot"],["\u3064\u307E\u5148","ToeBase"]])t(`${r}${o}`,`${a}${c}`);for(let[o,c]of[["\u4EBA\u6307","Index"],["\u4EBA\u5DEE\u6307","Index"],["\u4E2D\u6307","Middle"],["\u85AC\u6307","Ring"],["\u5C0F\u6307","Pinky"]])for(let l=1;l<=3;l++)t(`${r}${o}${l}`,`${a}Hand${c}${l}`);for(let o=0;o<=2;o++)t(`${r}\u89AA\u6307${o}`,`${a}HandThumb${o+1}`)}for(let[r,a]of[["L","Left"],["R","Right"]])["Thumb","Index","Middle","Ring","Pinky"].forEach((o,c)=>{for(let l=1;l<=3;l++)t(`${r} Finger${l===1?c:`${c}${l-1}`}`,`${a}Hand${o}${l}`)}),t(`${r} Toe0`,`${a}ToeBase`);for(let[r,a]of[["Spine4","Spine2"],["Neck1","Neck"],["Head1","Head"]])t(r,a);for(let[r,a]of[["chest","Spine1"],["lowerChest","Spine1"],["chestLower","Spine1"],["upperChest","Spine2"],["chestUpper","Spine2"],["abdomen","Spine"],["abdomenLower","Spine"],["abdomenUpper","Spine1"],["hip","Hips"],["lowerNeck","Neck"],["upperNeck","Neck"],["neckLower","Neck"],["neckUpper","Neck"],["neckTwist01","Neck"],["neckTwist02","Neck"],["torso","Spine"],["waist","Spine"],["upperTorso","Spine1"],["torsoUpper","Spine1"],["lowerTorso","Hips"],["torsoLower","Hips"],["ribcage","Spine1"],["ribs","Spine1"],["mPelvis","Hips"],["mTorso","Spine"],["mChest","Spine1"],["mNeck","Neck"],["mHead","Head"],["SpineBase","Hips"],["SpineMid","Spine"],["SpineShoulder","Spine2"],["root_M","Hips"],["hip_M","Hips"],["pelvis_M","Hips"],["spine1_M","Spine"],["spine2_M","Spine1"],["spine3_M","Spine2"],["chest_M","Spine2"],["neck_M","Neck"],["head_M","Head"],["spine0","Spine"],["hipMaster","Hips"],["lumbar","Spine"],["thoracic","Spine1"],["sternum","Spine2"],["cervical","Neck"],["cranium","Head"],["skull","Head"]])t(r,a);let s=[["leftUpperArm","LeftArm"],["lUpperArm","LeftArm"],["shoulderL","LeftArm"],["lShldr","LeftArm"],["lShldrBend","LeftArm"],["leftLowerArm","LeftForeArm"],["lLowerArm","LeftForeArm"],["elbowL","LeftForeArm"],["lForeArm","LeftForeArm"],["lForearmBend","LeftForeArm"],["forearmL","LeftForeArm"],["upperArmL","LeftArm"],["wristL","LeftHand"],["lHand","LeftHand"],["lCollar","LeftShoulder"],["collarL","LeftShoulder"],["lClavicle","LeftShoulder"],["leftUpperLeg","LeftUpLeg"],["lUpperLeg","LeftUpLeg"],["hipL","LeftUpLeg"],["lThigh","LeftUpLeg"],["lThighBend","LeftUpLeg"],["leftLowerLeg","LeftLeg"],["lLowerLeg","LeftLeg"],["kneeL","LeftLeg"],["shinL","LeftLeg"],["lShin","LeftLeg"],["lCalf","LeftLeg"],["ankleL","LeftFoot"],["lFoot","LeftFoot"],["leftToes","LeftToeBase"],["toeL","LeftToeBase"],["lToe","LeftToeBase"],["lToeBase","LeftToeBase"],["lArm","LeftArm"],["lShoulder","LeftShoulder"],["lLeg","LeftLeg"],["lUpLeg","LeftUpLeg"],["leftHip","LeftUpLeg"],["leftThigh","LeftUpLeg"],["leftKnee","LeftLeg"],["leftShin","LeftLeg"],["leftCalf","LeftLeg"],["leftAnkle","LeftFoot"],["leftElbow","LeftForeArm"],["leftWrist","LeftHand"],["leftCollar","LeftShoulder"],["leftClavicle","LeftShoulder"],["leftToe","LeftToeBase"],["mCollarLeft","LeftShoulder"],["mShoulderLeft","LeftArm"],["mElbowLeft","LeftForeArm"],["mWristLeft","LeftHand"],["mHipLeft","LeftUpLeg"],["mKneeLeft","LeftLeg"],["mAnkleLeft","LeftFoot"],["mFootLeft","LeftToeBase"],["mToeLeft","LeftToeBase"],["ShoulderLeft","LeftArm"],["ElbowLeft","LeftForeArm"],["WristLeft","LeftHand"],["HipLeft","LeftUpLeg"],["KneeLeft","LeftLeg"],["AnkleLeft","LeftFoot"],["FootLeft","LeftToeBase"],["leftHeel","LeftFoot"],["leftFootIndex","LeftToeBase"],["upperLegL","LeftUpLeg"],["lowerLegL","LeftLeg"],["lowerArmL","LeftForeArm"],["scapulaL","LeftShoulder"],["lHip","LeftUpLeg"],["lKnee","LeftLeg"],["lAnkle","LeftFoot"],["lElbow","LeftForeArm"],["lWrist","LeftHand"],["lToes","LeftToeBase"],["humerusL","LeftArm"],["lHumerus","LeftArm"],["ulnaL","LeftForeArm"],["lUlna","LeftForeArm"],["radiusL","LeftForeArm"],["lRadius","LeftForeArm"],["carpusL","LeftHand"],["lCarpus","LeftHand"],["femurL","LeftUpLeg"],["lFemur","LeftUpLeg"],["tibiaL","LeftLeg"],["lTibia","LeftLeg"],["fibulaL","LeftLeg"],["lFibula","LeftLeg"],["talusL","LeftFoot"],["lTalus","LeftFoot"],["tarsusL","LeftFoot"],["lTarsus","LeftFoot"],["calcaneusL","LeftFoot"],["lCalcaneus","LeftFoot"],["metatarsusL","LeftToeBase"],["lMetatarsus","LeftToeBase"]];for(let[r,a]of[["Thumb","Thumb"],["Index","Index"],["Middle","Middle"],["Ring","Ring"],["Pinky","Pinky"],["Little","Pinky"]]){let o=r.toLowerCase();for(let l=1;l<=3;l++){s.push([`l${r}${l}`,`LeftHand${a}${l}`]),s.push([`f_${o}.0${l}.L`,`LeftHand${a}${l}`]),s.push([`${o}.0${l}.L`,`LeftHand${a}${l}`]);let h=["Thumb","Index","Middle","Ring","Pinky"].indexOf(a)+1;h>0&&s.push([`finger${h}-${l}.L`,`LeftHand${a}${l}`])}(a==="Thumb"?["Metacarpal","Proximal","Distal"]:["Proximal","Intermediate","Distal"]).forEach((l,h)=>{s.push([`left${r}${l}`,`LeftHand${a}${h+1}`]),s.push([`${o}_${l.toLowerCase()}.L`,`LeftHand${a}${h+1}`])})}for(let r=1;r<=3;r++)s.push([`lMid${r}`,`LeftHandMiddle${r}`]);for(let[r,a]of[["Thumb","Thumb"],["Index","Index"],["Middle","Middle"],["Ring","Ring"],["Pinky","Pinky"],["Little","Pinky"]]){for(let o=1;o<=3;o++)s.push([`${r}${o}L`,`LeftHand${a}${o}`]),s.push([`${r}Finger${o}L`,`LeftHand${a}${o}`]);s.push([`${r}L`,`LeftHand${a}1`]),s.push([`${r}FingerL`,`LeftHand${a}1`])}for(let[r,a]of s){t(r,a);let o=a.replace(/^Left/,"Right"),c;/^left/.test(r)?c=r.replace(/^left/,"right"):/^l[A-Z]/.test(r)?c="r"+r.slice(1):/Left$/.test(r)?c=r.replace(/Left$/,"Right"):/L$/.test(r)?c=r.replace(/L$/,"R"):c=r,t(c,o)}return i})();rw=/shoulder|clavicle|collar|scapula/i,Lp=/upper.?arm|humerus/i,Pp=/clavicle|collar|scapula/i});var Lu,kp,Pu,xa,Dp=ct(()=>{"use strict";Lu=Object.freeze({Head:[-.11706881878098431,9438845082943482e-24,372654613409334e-22,.993123804804428],Hips:[.0010741148761599644,6537898515070053e-23,7022659074474357e-26,.9999994231384476],LeftArm:[-.003089573263103852,.08018148459223169,-.025041829737156785,.9964608827384491],LeftFoot:[.5523737034239063,.0002518875693487157,.0036538113016644914,.8335885543726441],LeftForeArm:[-26826767953574183e-23,12816740072681333e-23,.012369379808617674,.9999234962951223],LeftHand:[-.0012910117424963744,.002537815819541244,.010116448936771993,.9999447735952517],LeftHandIndex1:[.028803290204768833,.011362422123976328,.055965724298468224,.9979524555518633],LeftHandIndex2:[-.005195237841915152,.014315447122751807,.00021581682553071412,.9998840087229335],LeftHandIndex3:[-.0013151015878908295,-.016941197343945148,-.006458334440614796,.9998347644768737],LeftHandMiddle1:[.027532617383276645,-.031607746403852485,.016931179482824785,.9989775976007271],LeftHandMiddle2:[-.001267981765488788,.0010468621884392817,-.004466175725402764,.9999886747239598],LeftHandMiddle3:[-.0015803533040544947,.0018352886876119797,.0038040706030556736,.9999898315711762],LeftHandPinky1:[.009345046842530319,-.07377447953394943,-.04207784173776388,.9963430390695086],LeftHandPinky2:[-.0019002180814112143,.0002770864318134059,.0004968185265866393,.9999980327809131],LeftHandPinky3:[-.0014157518824255099,-.005595319155644295,-.004606740515194791,.9999727326242506],LeftHandRing1:[.018207541076892743,-.03436008716699126,-.036855349348364555,.9985637451229231],LeftHandRing2:[-.0006571286469542868,.015477225242721515,.01003471962236163,.9998296495318929],LeftHandRing3:[.001815607007583071,-.003099595768579846,.0072046170631637615,.999967594260012],LeftHandThumb1:[.1900227602341495,-.058826116539083484,.3478783626049766,.9161940209594684],LeftHandThumb2:[.01801363066187901,-.020968588375318502,-.22063576333056306,.9749644544258214],LeftHandThumb3:[-.014498565873099356,.03466160908487025,.011599642488048602,.9992266072970502],LeftLeg:[-.022987686472704008,-.0006608912898930547,7960712093047862e-20,.9997355266049326],LeftShoulder:[.5181706903502131,.5134387363832796,-.48299308003518876,.4843526489955184],LeftToeBase:[.23652217735689587,.0006644108661216591,-.002051152932444189,.9716236982227819],LeftUpLeg:[-4952055077835167e-20,.0032567616062252223,.9999946186652781,-.00039203576089550014],Neck:[.2225107795455935,-23352293238692193e-23,-19647139012020554e-24,.974930229804142],RightArm:[-.003089570938390283,-.08018164882954634,.025041835809991725,.9964608693782484],RightFoot:[.5523737112340288,-.00025188760500252676,-.0036538107149212758,.8335885491999105],RightForeArm:[-2706717415294191e-22,60675494372234465e-25,-.012369382961452784,.9999234962561284],RightHand:[-.0012910114923260908,-.002537815924782367,-.010116450486313036,.9999447735796301],RightHandIndex1:[.028803284769926347,-.01136242475457741,-.05596571258489258,.9979524563349205],RightHandIndex2:[-.005195229421057241,-.014315442233259087,-.00021582506177354608,.9998840088349297],RightHandIndex3:[-.0013151045827228072,.016941319655899355,.006458327385746035,.9998347624459482],RightHandMiddle1:[.027532662650122483,.03160778647114273,-.01693120529165708,.9989775946478099],RightHandMiddle2:[-.0012680273836480952,-.0010469047250576836,.004466199390698661,.9999886745158897],RightHandMiddle3:[-.0015803562094451136,-.001835288773706009,-.003804068167924464,.9999898315756854],RightHandPinky1:[.009345030274151258,.07377446325595405,.04207784564870347,.9963430402658229],RightHandPinky2:[-.0019002008217559384,-.0002769620503994165,-.0004968229018870381,.9999980328459891],RightHandPinky3:[-.0014157497333212687,.0055951881780210025,.004606743315319843,.9999727333471813],RightHandRing1:[.01820754441109714,.03436008722907556,.03685535429214536,.9985637448787448],RightHandRing2:[-.0006571335802527884,-.015477230302375519,-.010034723368684675,.999829649412505],RightHandRing3:[.0018156069598940002,.003099598646436032,-.007204626788931167,.9999675941811231],RightHandThumb1:[.19002276085311107,.05882618704962336,-.3478783387552461,.9161940229953188],RightHandThumb2:[.018013663274561078,.020968550782212388,.22063584956274163,.9749644350943654],RightHandThumb3:[-.014498582331377526,-.03466161961137741,-.011599713293476643,.9992266058762234],RightLeg:[-.022987685898989207,.0006609402907891899,-7960698692017099e-20,.9997355265857409],RightShoulder:[.5181706006117709,-.5134387953473804,.4829931766210871,.4843525890882128],RightToeBase:[.23652222014073046,-.0006644109035597298,.0020511526077556528,.9716236878087238],RightUpLeg:[49438593286575395e-21,.003256759408127677,.9999946186765544,.0003920356017771739],Spine:[-.018332562694809717,-14544833124647894e-23,26976261645093277e-26,.9998319444511763],Spine1:[-.03815628571181615,20010687323521798e-24,534807122500512e-23,.9992717837809081],Spine2:[-.056998031890724846,13546308636882866e-23,-8861325315468363e-25,.9983742907149431]}),kp=Object.freeze({Head:[-.005402766806732544,-15440620455356296e-23,834223242528311e-24,.9999854049488961],Hips:[.0010741148761599644,6537898515070053e-23,7022659074474357e-26,.9999994231384476],LeftArm:[.4889318420664182,.5108287295941205,-.5108290884863605,.48893078190839623],LeftFoot:[-7112359875637768e-20,.5349085331963127,.8448985998862468,-.004383145577274271],LeftForeArm:[.49521300584988104,.5047420653526237,-.5047420379230214,.4952120815979495],LeftHand:[.5009334720626235,.5016127781291206,-.4977959877649929,.49964931327533474],LeftHandIndex1:[.5480286232738694,.46388966319384123,-.47756977349452234,.506357703809076],LeftHandIndex2:[.5522711480640051,.4734474077351049,-.46714980714345783,.5026083894226862],LeftHandIndex3:[.5405471533897316,.46903549072233974,-.4790521335412708,.5082553896043159],LeftHandMiddle1:[.5069366564823887,.46312011824587895,-.5184714785961669,.5096295836965867],LeftHandMiddle2:[.5047591066222094,.46656986579426646,-.5196237813564338,.5074661907650336],LeftHandMiddle3:[.5066805225023663,.46639751835165716,-.5160243364733309,.509379123507728],LeftHandPinky1:[.4459394011607033,.4793433042957962,-.5586434331057456,.5092009093395086],LeftHandPinky2:[.4453638702749085,.48032344738196137,-.5573549331147079,.5101920146245817],LeftHandPinky3:[.4392981168466072,.4802964151504903,-.5615019919023976,.5109286011992389],LeftHandRing1:[.47371996160924823,.4931227775910745,-.5418410288696247,.4886999364902444],LeftHandRing2:[.48665266892609377,.49620490515614146,-.5291888435031511,.48673303168821197],LeftHandRing3:[.48945530931580683,.4902132045285772,-.5280743092981476,.4911843263440915],LeftHandThumb1:[.6991138207882592,.16132571576360077,-.40704633814367386,.5652673372230799],LeftHandThumb2:[.64766423234777,.2923511094450446,-.5391393932239583,.4520957758831027],LeftHandThumb3:[.6626872004096495,.3080994487427915,-.5067905211225114,.45725679518685386],LeftLeg:[.0006202111480182034,-.020805293540463354,.9997832430476497,-.00047118992773536965],LeftShoulder:[.4605450937998788,.4559956590278878,-.537559006794696,.5394409087622226],LeftToeBase:[-.002764355526654178,.7195640056310856,.6944147145329627,-.0028643286082629046],LeftUpLeg:[-4987623525000119e-20,.0021826506059020026,.9999975399461294,-.00039198262713485737],Neck:[.11170149382802401,-1628868597421303e-22,-18309282630496044e-24,.9937418056399563],RightArm:[.48893190585215524,-.510828798312402,.5108290283825504,.48893071200502375],RightFoot:[7112360405196955e-20,.5349085398019146,.844898595705669,.004383145306035045],RightForeArm:[.4952130023257164,-.5047420673116668,.5047420415306929,.49521208229448166],RightHand:[.5009334695181179,-.5016127792807403,.49779599067075153,.49964931459617906],RightHandIndex1:[.5480286139806538,-.4638896746971551,.47756977858103167,.5063577013132781],RightHandIndex2:[.5522711446711094,-.4734474082706649,.4671498147721218,.5026083883587248],RightHandIndex3:[.5405470934413514,-.4690354263302402,.47905220274050364,.5082554503330304],RightHandMiddle1:[.5069366680435416,-.4631200623546733,.5184715098400317,.5096295939664325],RightHandMiddle2:[.5047591061928465,-.46656986723577604,.5196237819671778,.5074661920185282],RightHandMiddle3:[.5066805195140975,-.4663975225827095,.5160243369168757,.5093791249234989],RightHandPinky1:[.44593939683725603,-.4793433241517071,.5586434219640141,.5092009094272859],RightHandPinky2:[.4453638073881448,-.4803233923217868,.5573549834847424,.5101920690951159],RightHandPinky3:[.4392981269307416,-.4802964267888911,.5615019867791732,.5109285899785551],RightHandRing1:[.473719957983008,-.49312277921221886,.541841035805614,.4886999335659278],RightHandRing2:[.48665266754747677,-.4962049100848307,.5291888437972645,.4867330306200585],RightHandRing3:[.4894553112113337,-.49021320332208906,.5280743062058759,.4911843318554558],RightHandThumb1:[.6991137732035737,-.16132569450370315,.40704638897707807,.5652673641991798],RightHandThumb2:[.6476641963757893,-.2923511418798965,.5391394672107036,.45209571648691005],RightHandThumb3:[.6626871862817486,-.3080994479425299,.5067905521115058,.4572567801626834],RightLeg:[-.0006202113471683521,-.020805295090456907,.9997832430151556,.00047119017271936915],RightShoulder:[.46054507521936333,-.45599564278848104,.5375590232993736,.5394409245169026],RightToeBase:[.0027643555231566678,.7195640416379069,.6944146772223956,.0028643286020973192],RightUpLeg:[49925034443819034e-21,.002182648459062353,.9999975399486299,.00039198198974856475],Spine:[-.017258617754264162,-800818266828763e-22,13823133775055108e-25,.9998510589648868],Spine1:[-.055396652424023016,-5997624651397324e-23,332759956947242e-23,.9984644264570511],Spine2:[-.11221710079276989,7513757486198981e-23,-8485311473269302e-24,.9936837134066652]}),Pu=Object.freeze({Head:[0,1.644459,-.02811],Hips:[0,.984089,.005022],LeftArm:[.204124,1.50826,-.034115],LeftFoot:[.095793,.088025,-.010018],LeftForeArm:[.458234,1.508259,-.045252],LeftHand:[.725837,1.508259,-.050352],LeftHandIndex1:[.815413,1.499602,-.024435],LeftHandIndex2:[.847794,1.497747,-.020782],LeftHandIndex3:[.872293,1.496601,-.017998],LeftHandMiddle1:[.820067,1.500491,-.048839],LeftHandMiddle2:[.854745,1.498698,-.047572],LeftHandMiddle3:[.881683,1.49736,-.046832],LeftHandPinky1:[.810112,1.495569,-.08743],LeftHandPinky2:[.8359,1.495002,-.089537],LeftHandPinky3:[.856018,1.494638,-.091171],LeftHandRing1:[.81666,1.499944,-.069059],LeftHandRing2:[.850313,1.498728,-.071468],LeftHandRing3:[.87354,1.497943,-.072665],LeftHandThumb1:[.761831,1.487283,-.024616],LeftHandThumb2:[.783931,1.477329,-.003377],LeftHandThumb3:[.806009,1.466616,.003515],LeftLeg:[.09541,.505427,.007362],LeftShoulder:[.056656,1.508576,-.035092],LeftToeBase:[.096919,.022281,.128921],LeftUpLeg:[.095072,.936186,.005482],Neck:[0,1.516499,-.057245],RightArm:[-.204124,1.50826,-.034115],RightFoot:[-.095793,.088025,-.010018],RightForeArm:[-.458234,1.508259,-.045252],RightHand:[-.725837,1.508259,-.050352],RightHandIndex1:[-.815413,1.499602,-.024435],RightHandIndex2:[-.847794,1.497747,-.020783],RightHandIndex3:[-.872293,1.496601,-.017998],RightHandMiddle1:[-.820067,1.500491,-.048839],RightHandMiddle2:[-.854745,1.498698,-.047572],RightHandMiddle3:[-.881683,1.49736,-.046832],RightHandPinky1:[-.810112,1.495569,-.08743],RightHandPinky2:[-.8359,1.495002,-.089537],RightHandPinky3:[-.856018,1.494638,-.091171],RightHandRing1:[-.81666,1.499944,-.069059],RightHandRing2:[-.850313,1.498729,-.071468],RightHandRing3:[-.87354,1.497943,-.072665],RightHandThumb1:[-.761831,1.487283,-.024615],RightHandThumb2:[-.783931,1.477329,-.003377],RightHandThumb3:[-.806009,1.466616,.003515],RightLeg:[-.09541,.505427,.007362],RightShoulder:[-.056656,1.508576,-.035092],RightToeBase:[-.096919,.022281,.128921],RightUpLeg:[-.095072,.936186,.005482],Spine:[0,1.077013,.005222],Spine1:[0,1.184494,.00151],Spine2:[0,1.330917,-.014788]}),xa=Object.freeze({Head:"Neck",Hips:null,LeftArm:"LeftShoulder",LeftFoot:"LeftLeg",LeftForeArm:"LeftArm",LeftHand:"LeftForeArm",LeftHandIndex1:"LeftHand",LeftHandIndex2:"LeftHandIndex1",LeftHandIndex3:"LeftHandIndex2",LeftHandMiddle1:"LeftHand",LeftHandMiddle2:"LeftHandMiddle1",LeftHandMiddle3:"LeftHandMiddle2",LeftHandPinky1:"LeftHand",LeftHandPinky2:"LeftHandPinky1",LeftHandPinky3:"LeftHandPinky2",LeftHandRing1:"LeftHand",LeftHandRing2:"LeftHandRing1",LeftHandRing3:"LeftHandRing2",LeftHandThumb1:"LeftHand",LeftHandThumb2:"LeftHandThumb1",LeftHandThumb3:"LeftHandThumb2",LeftLeg:"LeftUpLeg",LeftShoulder:"Spine2",LeftToeBase:"LeftFoot",LeftUpLeg:"Hips",Neck:"Spine2",RightArm:"RightShoulder",RightFoot:"RightLeg",RightForeArm:"RightArm",RightHand:"RightForeArm",RightHandIndex1:"RightHand",RightHandIndex2:"RightHandIndex1",RightHandIndex3:"RightHandIndex2",RightHandMiddle1:"RightHand",RightHandMiddle2:"RightHandMiddle1",RightHandMiddle3:"RightHandMiddle2",RightHandPinky1:"RightHand",RightHandPinky2:"RightHandPinky1",RightHandPinky3:"RightHandPinky2",RightHandRing1:"RightHand",RightHandRing2:"RightHandRing1",RightHandRing3:"RightHandRing2",RightHandThumb1:"RightHand",RightHandThumb2:"RightHandThumb1",RightHandThumb3:"RightHandThumb2",RightLeg:"RightUpLeg",RightShoulder:"Spine2",RightToeBase:"RightFoot",RightUpLeg:"Hips",Spine:"Hips",Spine1:"Spine",Spine2:"Spine1"})});function dw(i,e){for(let t=e?.parent;t;t=t.parent)if(t===i)return!0;return!1}function Xc(i){let e=[],t=new Set,n=a=>{if(!a?.name||t.has(a))return;t.add(a);let o=_n(a.name);o&&e.push({node:a,raw:a.name,canonical:o})},s=[];i.traverse(a=>{a.isSkinnedMesh&&s.push(a),a.isBone&&n(a)});for(let a of s)for(let o of a.skeleton?.bones||[])n(o);Ip(e,{isAncestor:(a,o)=>dw(a.node,o.node)});let r=new Set;return e.filter(a=>r.has(a.canonical)?!1:(r.add(a.canonical),!0))}function Op(i){let e=new Map;for(let{canonical:t,node:n}of Xc(i))e.set(t,n.name);return e}function fw(i){let e=new Map;if(!i?.traverse)return e;for(let{canonical:t,node:n}of Xc(i))e.set(t,n);return e}function Bp(i){let e=new Map;for(let{canonical:t,node:n}of Xc(i))e.set(t,n.quaternion.clone());return e}function pw(i,e){let t=i.quaternion.clone();for(let n=i.parent;n&&n!==e;n=n.parent)t.premultiply(n.quaternion);return t}function Hp(i){let e=new Map;for(let{canonical:t,node:n}of Xc(i))e.set(t,pw(n,i));return e}function mw(i,e){let t=new Map;for(let[n,s]of Object.entries(Np)){let r=i.get(n),a=i.get(s);if(!r||!a)continue;let o=e(a).sub(e(r));o.lengthSq()>1e-12&&t.set(n,o.normalize())}return t}function zp(i){if(!i?.traverse)return new Map;i.updateMatrixWorld(!0);let e=fw(i);return mw(e,t=>i.worldToLocal(t.getWorldPosition(new L)))}function gw(i){let e=new Map;if(!(i instanceof Map)||i.size===0)return e;let t=new Map,n=new L;for(let s of uw){let r=t.get(xa[s])||null;if(lw.has(s))continue;let a=i.get(s),o=Up.get(s);if(!a||!o){r&&t.set(s,r);continue}n.copy(a),r&&n.applyQuaternion(r);let c=n.dot(o)>hw?null:new ge().setFromUnitVectors(n,o);c&&r?t.set(s,c.multiply(r)):(c||r)&&t.set(s,c||r)}for(let[s,r]of t)1-Math.abs(r.w)>=qc&&e.set(s,r);return e}function Vp(i){let e=new Map;return i.traverse(t=>{if(!(!t?.morphTargetDictionary||!t.name))for(let n of Object.keys(t.morphTargetDictionary)){e.has(n)||e.set(n,[]);let s=e.get(n);s.includes(t.name)||s.push(t.name)}}),e}function _w(i,e,t){let n=new Map;if(!(i instanceof Map))return n;let s=e instanceof Map,r=s?gw(t):new Map;for(let[a,o]of ow){let c=i.get(a);if(!c)continue;let l=cw.get(a),h=s?e.get(a):null,u,d=null;if(l&&h){let g=r.get(a),_=r.get(xa[a]);u=c.clone().multiply(h.clone().invert()),_&&u.multiply(_.clone().invert()),u.multiply(l).multiply(o.clone().invert()),d=l.clone().invert(),g&&d.multiply(g),d.multiply(h),1-Math.abs(d.w)<qc&&(d=null)}else u=c.clone().multiply(o.clone().invert());let f=1-Math.abs(u.w)<qc;f&&!d||n.set(a,{L:f?null:u,R:d})}return n}function bw(i,{L:e,R:t}){for(let n=0;n<i.length;n+=4)xs.set(i[n],i[n+1],i[n+2],i[n+3]),e&&xs.premultiply(e),t&&xs.multiply(t),i[n]=xs.x,i[n+1]=xs.y,i[n+2]=xs.z,i[n+3]=xs.w}function xw(i,e){for(let t=0;t<i.length;t+=3)Gc.set(i[t],i[t+1],i[t+2]).applyQuaternion(e),i[t]=Gc.x,i[t+1]=Gc.y,i[t+2]=Gc.z}function vw(i,e){if(i){let t=i.isQuaternion?i.clone():new ge(i[0],i[1],i[2],i[3]);return t.invert(),1-Math.abs(t.w)<qc?null:t}return e.get("Hips")?.L||null}function Gp(i){let e=null;if(i.traverse(n=>{!e&&n.isBone&&n.name&&_n(n.name)==="Hips"&&(e=n)}),e||i.traverse(n=>{!e&&n.name&&_n(n.name)==="Hips"&&(e=n)}),!e||!e.parent)return null;let t=new ge;for(let n=e.parent;n&&n!==i;n=n.parent)t.premultiply(n.quaternion);return t}function Wp(i){try{return new Tt().setFromObject(i).min.y}catch{return NaN}}function Iu(i){let e=null;if(i.traverse(r=>{!e&&r.isBone&&r.name&&_n(r.name)==="Hips"&&(e=r)}),e||i.traverse(r=>{!e&&r.name&&_n(r.name)==="Hips"&&(e=r)}),!e||!e.parent)return 0;e.updateWorldMatrix(!0,!1),e.getWorldPosition(mr);let t=mr.y,n=Wp(i);Number.isFinite(n)&&(t-=n),e.parent.matrixWorld.decompose(mr,yw,Wc);let s=(Wc.x+Wc.y+Wc.z)/3;return!(s>1e-6)||!(t>0)||!Number.isFinite(t)?0:t/s}function ku(i){let e=null;if(i.traverse(s=>{!e&&s.isBone&&s.name&&_n(s.name)==="Hips"&&(e=s)}),e||i.traverse(s=>{!e&&s.name&&_n(s.name)==="Hips"&&(e=s)}),!e||!e.parent)return 0;e.updateWorldMatrix(!0,!1);let t=Wp(i);if(!Number.isFinite(t))return 0;e.getWorldPosition(mr);let n=e.parent.worldToLocal(new L(mr.x,t,mr.z));return Number.isFinite(n.y)?n.y:0}function qp(i){let e=i.tracks.find(t=>t.name.endsWith(".position")&&_n(t.name.split(".")[0])==="Hips");return!e||e.values.length<3?0:e.values[1]}function Xp(i,e,t={}){let n=Number.isFinite(t.hipScale)&&t.hipScale>0?t.hipScale:1,s=Number.isFinite(t.hipOffsetY)?t.hipOffsetY:0,r=t.minCoverage??aw,a=_w(t.targetRest,t.targetWorldRest,t.targetRestDirections),o=vw(t.hipsParentWorldQuat,a),c=[],l=[],h=[],u=0;for(let _ of i.tracks){let m=_.name.indexOf(".");if(m===-1)continue;let p=_.name.slice(0,m),x=_.name.slice(m+1);if(x.startsWith(Fp)){let R=x.slice(Fp.length,-1),b=t.morphTargets instanceof Map?t.morphTargets.get(R):null;if(!b?.length){c.push(R);continue}for(let T of b){let P=_.clone();P.name=`${T}.${x}`,h.push(P)}continue}let y=_n(p)||p;if(!(x==="quaternion"||x==="position"&&y==="Hips"))continue;u++;let A=e.get(y);if(!A){c.push(y);continue}let S=_.clone();if(S.name=`${A}.${x}`,x==="quaternion"){let R=a.get(y);R&&bw(S.values,R)}else{if(o&&xw(S.values,o),n!==1)for(let R=0;R<S.values.length;R++)S.values[R]*=n;if(s!==0)for(let R=1;R<S.values.length;R+=3)S.values[R]+=s}l.push(S)}let d=l.length,f=u>0?d/u:0;if(f<r)return{clip:null,matched:d,total:u,coverage:f,dropped:c,hipScale:n,face:0};let g=i.clone();return g.tracks=[...l,...h],{clip:g,matched:d,total:u,coverage:f,dropped:c,hipScale:n,face:h.length}}var aw,ow,cw,qc,Np,lw,hw,Up,uw,Fp,Gc,xs,mr,yw,Wc,jp=ct(()=>{"use strict";lt();Vc();Dp();aw=.5,ow=new Map(Object.entries(Lu).map(([i,e])=>[i,new ge(e[0],e[1],e[2],e[3])])),cw=new Map(Object.entries(kp).map(([i,e])=>[i,new ge(e[0],e[1],e[2],e[3])])),qc=1e-6,Np=Object.freeze({LeftArm:"LeftForeArm",LeftForeArm:"LeftHand",RightArm:"RightForeArm",RightForeArm:"RightHand",LeftUpLeg:"LeftLeg",LeftLeg:"LeftFoot",RightUpLeg:"RightLeg",RightLeg:"RightFoot"}),lw=new Set(["LeftFoot","RightFoot"]),hw=1-1e-6,Up=new Map;for(let[i,e]of Object.entries(Np)){let t=Pu[i],n=Pu[e];if(!t||!n)continue;let s=new L(n[0]-t[0],n[1]-t[1],n[2]-t[2]);s.lengthSq()>1e-12&&Up.set(i,s.normalize())}uw=(()=>{let i=e=>{let t=0;for(let n=xa[e];n;n=xa[n])t++;return t};return Object.keys(Lu).sort((e,t)=>i(e)-i(t))})(),Fp="morphTargetInfluences[",Gc=new L,xs=new ge;mr=new L,yw=new ge,Wc=new L});function Aw(i){for(let e of i.children)if(e.isBone)return e;return null}function Qp(i,e){if(!i||e&&(e.has("LeftArm")||e.has("RightArm")))return 0;i.updateMatrixWorld(!0);let t=[],n=1/0,s=-1/0;if(i.traverse(l=>{if(!l.isBone)return;let h=Aw(l);if(!h)return;l.getWorldPosition(Du),h.getWorldPosition(Yp);let u=Yp.clone().sub(Du),d=u.length();if(d<1e-5)return;u.multiplyScalar(1/d);let f=Du.y;f<n&&(n=f),f>s&&(s=f),t.push({bone:l,worldY:f,dir:u})}),t.length===0||!Number.isFinite(n)||s<=n)return 0;let r=(n+s)/2,a=null,o=null;for(let l of t){let{dir:h,worldY:u}=l;u<r||Math.abs(h.y)>Mw||h.y<Sw||Math.abs(h.x)<ww||(h.x>0?(!a||h.x>a.dir.x)&&(a=l):(!o||h.x<o.dir.x)&&(o=l))}let c=0;for(let l of[a,o])l&&Ew(l.bone,l.dir)&&c++;return c}function Ew(i,e){let t=e.x>=0?1:-1;Jp.set(t*.14,-1,.1).normalize(),Kp.copy(e),$p.setFromUnitVectors(Kp,Jp),i.getWorldQuaternion(Zp),i.parent?i.parent.getWorldQuaternion(Fu):Fu.identity();let n=$p.multiply(Zp),s=Fu.invert().multiply(n);return i.quaternion.copy(s),i.updateMatrixWorld(!0),!0}var ww,Mw,Sw,Du,Yp,Kp,Jp,$p,Zp,Fu,em=ct(()=>{"use strict";lt();ww=.6,Mw=.38,Sw=-.4,Du=new L,Yp=new L,Kp=new L,Jp=new L,$p=new ge,Zp=new ge,Fu=new ge});function Tw(){if(typeof window>"u")return!1;try{let i=new URLSearchParams(window.location.search);if(i.has("debug")&&i.get("debug")!=="0"||window.localStorage?.getItem("tws:debug")==="1")return!0}catch{}return!1}var Rw,jc,ya,va,bn,tm=ct(()=>{"use strict";Rw=!1,jc=Rw||Tw(),ya=()=>{},va=i=>typeof console<"u"&&typeof console[i]=="function"?console[i].bind(console):ya,bn={error:va("error"),warn:jc?va("warn"):ya,info:jc?va("info"):ya,debug:jc?va("debug"):ya,log:jc?va("log"):ya}});var Pm={};Ca(Pm,{VRMAnimation:()=>Lm,VRMAnimationLoaderPlugin:()=>Zw,VRMLookAtQuaternionProxy:()=>zu,createVRMAnimationClip:()=>jw,createVRMAnimationExpressionTracks:()=>Rm,createVRMAnimationHumanoidTracks:()=>Tm,createVRMAnimationLookAtTrack:()=>Cm});function Cw(i,e,t){var n,s;let r=i.parser.json,a=(n=r.nodes)==null?void 0:n[e];if(a==null)return console.warn(`extractPrimitivesInternal: Attempt to use nodes[${e}] of glTF but the node doesn't exist`),null;let o=a.mesh;if(o==null)return null;let c=(s=r.meshes)==null?void 0:s[o];if(c==null)return console.warn(`extractPrimitivesInternal: Attempt to use meshes[${o}] of glTF but the mesh doesn't exist`),null;let l=c.primitives.length,h=[];return t.traverse(u=>{h.length<l&&u.isMesh&&h.push(u)}),h}function sm(i,e){return Tn(this,null,function*(){let t=yield i.parser.getDependency("node",e);return Cw(i,e,t)})}function Lw(i){return Math.max(Math.min(i,1),0)}function Fw(i){return i.invert?i.invert():i.inverse(),i}function Hu(i,e){return i.matrixWorld.decompose(Nw,e,Uw),e}function Yc(i){return[Math.atan2(-i.z,i.x),Math.atan2(i.y,Math.sqrt(i.x*i.x+i.z*i.z))]}function dm(i){let e=Math.round(i/2/Math.PI);return i-2*Math.PI*e}function Tm(i,e,t){var n,s;let r=new Map,a=new Map;for(let[o,c]of i.humanoidTracks.rotation.entries()){let l=(n=e.getNormalizedBoneNode(o))==null?void 0:n.name;if(l!=null){let h=new Sn(`${l}.quaternion`,c.times,c.values.map((u,d)=>t==="0"&&d%2===0?-u:u));a.set(o,h)}}for(let[o,c]of i.humanoidTracks.translation.entries()){let l=(s=e.getNormalizedBoneNode(o))==null?void 0:s.name;if(l!=null){let h=i.restHipsPosition.y,d=e.normalizedRestPose.hips.position[1]/h,f=c.clone();f.values=f.values.map((g,_)=>(t==="0"&&_%3!==1?-g:g)*d),f.name=`${l}.position`,r.set(o,f)}}return{translation:r,rotation:a}}function Rm(i,e){let t=new Map,n=new Map;for(let[s,r]of i.expressionTracks.preset.entries()){let a=e.getExpressionTrackName(s);if(a!=null){let o=r.clone();o.name=a,t.set(s,o)}}for(let[s,r]of i.expressionTracks.custom.entries()){let a=e.getExpressionTrackName(s);if(a!=null){let o=r.clone();o.name=a,n.set(s,o)}}return{preset:t,custom:n}}function Cm(i,e){if(i.lookAtTrack==null)return null;let t=i.lookAtTrack.clone();return t.name=e,t}function jw(i,e){let t=[],n=Tm(i,e.humanoid,e.meta.metaVersion);if(t.push(...n.translation.values()),t.push(...n.rotation.values()),e.expressionManager!=null){let s=Rm(i,e.expressionManager);t.push(...s.preset.values()),t.push(...s.custom.values())}if(e.lookAt!=null){let s=e.scene.children.find(a=>a instanceof zu);s==null?(console.warn("createVRMAnimationClip: VRMLookAtQuaternionProxy is not found. Creating a new one automatically. To suppress this warning, create a VRMLookAtQuaternionProxy manually"),s=new zu(e.lookAt),s.name="VRMLookAtQuaternionProxy",e.scene.add(s)):s.name===""&&(console.warn("createVRMAnimationClip: VRMLookAtQuaternionProxy is found but its name is not set. Setting the name automatically. To suppress this warning, set the name manually"),s.name="VRMLookAtQuaternionProxy");let r=Cm(i,`${s.name}.quaternion`);r!=null&&t.push(r)}return new $t("Clip",i.duration,t)}function gm(i,e){let t=i.length,n=[],s=[],r=0;for(let a=0;a<t;a++){let o=i[a];r<=0&&(r=e,s=[],n.push(s)),s.push(o),r--}return n}var nm,Tn,im,Kc,rm,wa,Pw,Iw,xm,am,om,cm,ym,lm,kw,Dw,Sm,OE,BE,HE,hm,zE,VE,GE,WE,qE,XE,jE,YE,KE,um,JE,$E,Nw,Uw,fm,Ow,Bw,Hw,zw,Nu,pm,Vw,Uu,Am,Gw,Ww,ii,gr,En,qw,Xw,mm,Ou,zu,Lm,Yw,Ma,Bu,_m,Kw,Jw,$w,Zw,Im=ct(()=>{lt();lt();lt();lt();lt();lt();lt();lt();lt();lt();lt();lt();lt();lt();lt();lt();lt();nm=(i,e,t)=>new Promise((n,s)=>{var r=c=>{try{o(t.next(c))}catch(l){s(l)}},a=c=>{try{o(t.throw(c))}catch(l){s(l)}},o=c=>c.done?n(c.value):Promise.resolve(c.value).then(r,a);o((t=t.apply(i,e)).next())}),Tn=(i,e,t)=>new Promise((n,s)=>{var r=c=>{try{o(t.next(c))}catch(l){s(l)}},a=c=>{try{o(t.throw(c))}catch(l){s(l)}},o=c=>c.done?n(c.value):Promise.resolve(c.value).then(r,a);o((t=t.apply(i,e)).next())}),im=class extends rt{constructor(i){super(),this.weight=0,this.isBinary=!1,this.overrideBlink="none",this.overrideLookAt="none",this.overrideMouth="none",this._binds=[],this.name=`VRMExpression_${i}`,this.expressionName=i,this.type="VRMExpression",this.visible=!1}get binds(){return this._binds}get overrideBlinkAmount(){return this.overrideBlink==="block"?0<this.outputWeight?1:0:this.overrideBlink==="blend"?this.outputWeight:0}get overrideLookAtAmount(){return this.overrideLookAt==="block"?0<this.outputWeight?1:0:this.overrideLookAt==="blend"?this.outputWeight:0}get overrideMouthAmount(){return this.overrideMouth==="block"?0<this.outputWeight?1:0:this.overrideMouth==="blend"?this.outputWeight:0}get outputWeight(){return this.isBinary?this.weight>.5?1:0:this.weight}addBind(i){this._binds.push(i)}deleteBind(i){let e=this._binds.indexOf(i);e>=0&&this._binds.splice(e,1)}applyWeight(i){var e;let t=this.outputWeight;t*=(e=i?.multiplier)!=null?e:1,this.isBinary&&t<1&&(t=0),this._binds.forEach(n=>n.applyWeight(t))}clearAppliedWeight(){this._binds.forEach(i=>i.clearAppliedWeight())}};Kc={Aa:"aa",Ih:"ih",Ou:"ou",Ee:"ee",Oh:"oh",Blink:"blink",Happy:"happy",Angry:"angry",Sad:"sad",Relaxed:"relaxed",LookUp:"lookUp",Surprised:"surprised",LookDown:"lookDown",LookLeft:"lookLeft",LookRight:"lookRight",BlinkLeft:"blinkLeft",BlinkRight:"blinkRight",Neutral:"neutral"};rm=class bm{constructor(){this.blinkExpressionNames=["blink","blinkLeft","blinkRight"],this.lookAtExpressionNames=["lookLeft","lookRight","lookUp","lookDown"],this.mouthExpressionNames=["aa","ee","ih","oh","ou"],this._expressions=[],this._expressionMap={}}get expressions(){return this._expressions.concat()}get expressionMap(){return Object.assign({},this._expressionMap)}get presetExpressionMap(){let e={},t=new Set(Object.values(Kc));return Object.entries(this._expressionMap).forEach(([n,s])=>{t.has(n)&&(e[n]=s)}),e}get customExpressionMap(){let e={},t=new Set(Object.values(Kc));return Object.entries(this._expressionMap).forEach(([n,s])=>{t.has(n)||(e[n]=s)}),e}copy(e){return this._expressions.concat().forEach(n=>{this.unregisterExpression(n)}),e._expressions.forEach(n=>{this.registerExpression(n)}),this.blinkExpressionNames=e.blinkExpressionNames.concat(),this.lookAtExpressionNames=e.lookAtExpressionNames.concat(),this.mouthExpressionNames=e.mouthExpressionNames.concat(),this}clone(){return new bm().copy(this)}getExpression(e){var t;return(t=this._expressionMap[e])!=null?t:null}registerExpression(e){this._expressions.push(e),this._expressionMap[e.expressionName]=e}unregisterExpression(e){let t=this._expressions.indexOf(e);t===-1&&console.warn("VRMExpressionManager: The specified expressions is not registered"),this._expressions.splice(t,1),delete this._expressionMap[e.expressionName]}getValue(e){var t;let n=this.getExpression(e);return(t=n?.weight)!=null?t:null}setValue(e,t){let n=this.getExpression(e);n&&(n.weight=Lw(t))}resetValues(){this._expressions.forEach(e=>{e.weight=0})}getExpressionTrackName(e){let t=this.getExpression(e);return t?`${t.name}.weight`:null}update(){let e=this._calculateWeightMultipliers();this._expressions.forEach(t=>{t.clearAppliedWeight()}),this._expressions.forEach(t=>{let n=1,s=t.expressionName;this.blinkExpressionNames.indexOf(s)!==-1&&(n*=e.blink),this.lookAtExpressionNames.indexOf(s)!==-1&&(n*=e.lookAt),this.mouthExpressionNames.indexOf(s)!==-1&&(n*=e.mouth),t.applyWeight({multiplier:n})})}_calculateWeightMultipliers(){let e=1,t=1,n=1;return this._expressions.forEach(s=>{e-=s.overrideBlinkAmount,t-=s.overrideLookAtAmount,n-=s.overrideMouthAmount}),e=Math.max(0,e),t=Math.max(0,t),n=Math.max(0,n),{blink:e,lookAt:t,mouth:n}}},wa={Color:"color",EmissionColor:"emissionColor",ShadeColor:"shadeColor",MatcapColor:"matcapColor",RimColor:"rimColor",OutlineColor:"outlineColor"},Pw={_Color:wa.Color,_EmissionColor:wa.EmissionColor,_ShadeColor:wa.ShadeColor,_RimColor:wa.RimColor,_OutlineColor:wa.OutlineColor},Iw=new Ee,xm=class vm{constructor({material:e,type:t,targetValue:n,targetAlpha:s}){this.material=e,this.type=t,this.targetValue=n,this.targetAlpha=s??1;let r=this._initColorBindState(),a=this._initAlphaBindState();this._state={color:r,alpha:a}}applyWeight(e){let{color:t,alpha:n}=this._state;if(t!=null){let{propertyName:s,deltaValue:r}=t,a=this.material[s];a?.add(Iw.copy(r).multiplyScalar(e))}if(n!=null){let{propertyName:s,deltaValue:r}=n;this.material[s]!=null&&(this.material[s]+=r*e)}}clearAppliedWeight(){let{color:e,alpha:t}=this._state;if(e!=null){let{propertyName:n,initialValue:s}=e,r=this.material[n];r?.copy(s)}if(t!=null){let{propertyName:n,initialValue:s}=t;this.material[n]!=null&&(this.material[n]=s)}}_initColorBindState(){var e,t,n;let{material:s,type:r,targetValue:a}=this,o=this._getPropertyNameMap(),c=(t=(e=o?.[r])==null?void 0:e[0])!=null?t:null;if(c==null)return console.warn(`Tried to add a material color bind to the material ${(n=s.name)!=null?n:"(no name)"}, the type ${r} but the material or the type is not supported.`),null;let h=s[c].clone(),u=new Ee(a.r-h.r,a.g-h.g,a.b-h.b);return{propertyName:c,initialValue:h,deltaValue:u}}_initAlphaBindState(){var e,t,n;let{material:s,type:r,targetAlpha:a}=this,o=this._getPropertyNameMap(),c=(t=(e=o?.[r])==null?void 0:e[1])!=null?t:null;if(c==null&&a!==1)return console.warn(`Tried to add a material alpha bind to the material ${(n=s.name)!=null?n:"(no name)"}, the type ${r} but the material or the type does not support alpha.`),null;if(c==null)return null;let l=s[c],h=a-l;return{propertyName:c,initialValue:l,deltaValue:h}}_getPropertyNameMap(){var e,t;return(t=(e=Object.entries(vm._propertyNameMapMap).find(([n])=>this.material[n]===!0))==null?void 0:e[1])!=null?t:null}};xm._propertyNameMapMap={isMeshStandardMaterial:{color:["color","opacity"],emissionColor:["emissive",null]},isMeshBasicMaterial:{color:["color","opacity"]},isMToonMaterial:{color:["color","opacity"],emissionColor:["emissive",null],outlineColor:["outlineColorFactor",null],matcapColor:["matcapFactor",null],rimColor:["parametricRimColorFactor",null],shadeColor:["shadeColorFactor",null]}};am=xm,om=class{constructor({primitives:i,index:e,weight:t}){this.primitives=i,this.index=e,this.weight=t}applyWeight(i){this.primitives.forEach(e=>{var t;((t=e.morphTargetInfluences)==null?void 0:t[this.index])!=null&&(e.morphTargetInfluences[this.index]+=this.weight*i)})}clearAppliedWeight(){this.primitives.forEach(i=>{var e;((e=i.morphTargetInfluences)==null?void 0:e[this.index])!=null&&(i.morphTargetInfluences[this.index]=0)})}},cm=new Ie,ym=class wm{constructor({material:e,scale:t,offset:n}){var s,r;this.material=e,this.scale=t,this.offset=n;let a=(s=Object.entries(wm._propertyNamesMap).find(([o])=>e[o]===!0))==null?void 0:s[1];a==null?(console.warn(`Tried to add a texture transform bind to the material ${(r=e.name)!=null?r:"(no name)"} but the material is not supported.`),this._properties=[]):(this._properties=[],a.forEach(o=>{var c;let l=(c=e[o])==null?void 0:c.clone();if(!l)return null;e[o]=l;let h=l.offset.clone(),u=l.repeat.clone(),d=n.clone().sub(h),f=t.clone().sub(u);this._properties.push({name:o,initialOffset:h,deltaOffset:d,initialScale:u,deltaScale:f})}))}applyWeight(e){this._properties.forEach(t=>{let n=this.material[t.name];n!==void 0&&(n.offset.add(cm.copy(t.deltaOffset).multiplyScalar(e)),n.repeat.add(cm.copy(t.deltaScale).multiplyScalar(e)))})}clearAppliedWeight(){this._properties.forEach(e=>{let t=this.material[e.name];t!==void 0&&(t.offset.copy(e.initialOffset),t.repeat.copy(e.initialScale))})}};ym._propertyNamesMap={isMeshStandardMaterial:["map","emissiveMap","bumpMap","normalMap","displacementMap","roughnessMap","metalnessMap","alphaMap"],isMeshBasicMaterial:["map","specularMap","alphaMap"],isMToonMaterial:["map","normalMap","emissiveMap","shadeMultiplyTexture","rimMultiplyTexture","outlineWidthMultiplyTexture","uvAnimationMaskTexture"]};lm=ym,kw=new Set(["1.0","1.0-beta"]),Dw=class Mm{get name(){return"VRMExpressionLoaderPlugin"}constructor(e){this.parser=e}afterRoot(e){return Tn(this,null,function*(){e.userData.vrmExpressionManager=yield this._import(e)})}_import(e){return Tn(this,null,function*(){let t=yield this._v1Import(e);if(t)return t;let n=yield this._v0Import(e);return n||null})}_v1Import(e){return Tn(this,null,function*(){var t,n;let s=this.parser.json;if(!(((t=s.extensionsUsed)==null?void 0:t.indexOf("VRMC_vrm"))!==-1))return null;let a=(n=s.extensions)==null?void 0:n.VRMC_vrm;if(!a)return null;let o=a.specVersion;if(!kw.has(o))return console.warn(`VRMExpressionLoaderPlugin: Unknown VRMC_vrm specVersion "${o}"`),null;let c=a.expressions;if(!c)return null;let l=new Set(Object.values(Kc)),h=new Map;c.preset!=null&&Object.entries(c.preset).forEach(([d,f])=>{if(f!=null){if(!l.has(d)){console.warn(`VRMExpressionLoaderPlugin: Unknown preset name "${d}" detected. Ignoring the expression`);return}h.set(d,f)}}),c.custom!=null&&Object.entries(c.custom).forEach(([d,f])=>{if(l.has(d)){console.warn(`VRMExpressionLoaderPlugin: Custom expression cannot have preset name "${d}". Ignoring the expression`);return}h.set(d,f)});let u=new rm;return yield Promise.all(Array.from(h.entries()).map(d=>Tn(this,[d],function*([f,g]){var _,m,p,x,y,w,A;let S=new im(f);if(e.scene.add(S),S.isBinary=(_=g.isBinary)!=null?_:!1,S.overrideBlink=(m=g.overrideBlink)!=null?m:"none",S.overrideLookAt=(p=g.overrideLookAt)!=null?p:"none",S.overrideMouth=(x=g.overrideMouth)!=null?x:"none",(y=g.morphTargetBinds)==null||y.forEach(R=>Tn(this,null,function*(){var b;if(R.node===void 0||R.index===void 0)return;let T=yield sm(e,R.node),P=R.index;if(!T.every(C=>Array.isArray(C.morphTargetInfluences)&&P<C.morphTargetInfluences.length)){console.warn(`VRMExpressionLoaderPlugin: ${g.name} attempts to index morph #${P} but not found.`);return}S.addBind(new om({primitives:T,index:P,weight:(b=R.weight)!=null?b:1}))})),g.materialColorBinds||g.textureTransformBinds){let R=[];e.scene.traverse(b=>{let T=b.material;T&&(Array.isArray(T)?R.push(...T):R.push(T))}),(w=g.materialColorBinds)==null||w.forEach(b=>Tn(this,null,function*(){R.filter(P=>{var C;let N=(C=this.parser.associations.get(P))==null?void 0:C.materials;return b.material===N}).forEach(P=>{S.addBind(new am({material:P,type:b.type,targetValue:new Ee().fromArray(b.targetValue),targetAlpha:b.targetValue[3]}))})})),(A=g.textureTransformBinds)==null||A.forEach(b=>Tn(this,null,function*(){R.filter(P=>{var C;let N=(C=this.parser.associations.get(P))==null?void 0:C.materials;return b.material===N}).forEach(P=>{var C,N;S.addBind(new lm({material:P,offset:new Ie().fromArray((C=b.offset)!=null?C:[0,0]),scale:new Ie().fromArray((N=b.scale)!=null?N:[1,1])}))})}))}u.registerExpression(S)}))),u})}_v0Import(e){return Tn(this,null,function*(){var t;let n=this.parser.json,s=(t=n.extensions)==null?void 0:t.VRM;if(!s)return null;let r=s.blendShapeMaster;if(!r)return null;let a=new rm,o=r.blendShapeGroups;if(!o)return a;let c=new Set;return yield Promise.all(o.map(l=>Tn(this,null,function*(){var h;let u=l.presetName,d=u!=null&&Mm.v0v1PresetNameMap[u]||null,f=d??l.name;if(f==null){console.warn("VRMExpressionLoaderPlugin: One of custom expressions has no name. Ignoring the expression");return}if(c.has(f)){console.warn(`VRMExpressionLoaderPlugin: An expression preset ${u} has duplicated entries. Ignoring the expression`);return}c.add(f);let g=new im(f);e.scene.add(g),g.isBinary=(h=l.isBinary)!=null?h:!1,l.binds&&l.binds.forEach(m=>Tn(this,null,function*(){var p;if(m.mesh===void 0||m.index===void 0)return;let x=[];if((p=n.nodes)==null||p.forEach((w,A)=>{w.mesh===m.mesh&&x.push(A)}),x.length===0){console.warn(`VRMExpressionLoaderPlugin: ${l.name} attempts to bind a morph target to the mesh #${m.mesh} but the mesh is not found or not used in the scene. Ignoring the bind.`);return}let y=m.index;yield Promise.all(x.map(w=>Tn(this,null,function*(){var A;let S=yield sm(e,w);if(!S.every(R=>Array.isArray(R.morphTargetInfluences)&&y<R.morphTargetInfluences.length)){console.warn(`VRMExpressionLoaderPlugin: ${l.name} attempts to index ${y}th morph but not found.`);return}g.addBind(new om({primitives:S,index:y,weight:.01*((A=m.weight)!=null?A:100)}))})))}));let _=l.materialValues;_&&_.length!==0&&_.forEach(m=>{if(m.materialName===void 0||m.propertyName===void 0||m.targetValue===void 0)return;let p=[];e.scene.traverse(y=>{if(y.material){let w=y.material;Array.isArray(w)?p.push(...w.filter(A=>(A.name===m.materialName||A.name===m.materialName+" (Outline)")&&p.indexOf(A)===-1)):w.name===m.materialName&&p.indexOf(w)===-1&&p.push(w)}});let x=m.propertyName;p.forEach(y=>{if(x==="_MainTex_ST"){let A=new Ie(m.targetValue[0],m.targetValue[1]),S=new Ie(m.targetValue[2],m.targetValue[3]);S.y=1-S.y-A.y,g.addBind(new lm({material:y,scale:A,offset:S}));return}let w=Pw[x];if(w){g.addBind(new am({material:y,type:w,targetValue:new Ee().fromArray(m.targetValue),targetAlpha:m.targetValue[3]}));return}console.warn(x+" is not supported")})}),a.registerExpression(g)}))),a})}};Dw.v0v1PresetNameMap={a:"aa",e:"ee",i:"ih",o:"oh",u:"ou",blink:"blink",joy:"happy",angry:"angry",sorrow:"sad",fun:"relaxed",lookup:"lookUp",lookdown:"lookDown",lookleft:"lookLeft",lookright:"lookRight",blink_l:"blinkLeft",blink_r:"blinkRight",neutral:"neutral"};Sm=class _r{constructor(e,t){this._firstPersonOnlyLayer=_r.DEFAULT_FIRSTPERSON_ONLY_LAYER,this._thirdPersonOnlyLayer=_r.DEFAULT_THIRDPERSON_ONLY_LAYER,this._initializedLayers=!1,this.humanoid=e,this.meshAnnotations=t}copy(e){if(this.humanoid!==e.humanoid)throw new Error("VRMFirstPerson: humanoid must be same in order to copy");return this.meshAnnotations=e.meshAnnotations.map(t=>({meshes:t.meshes.concat(),type:t.type})),this}clone(){return new _r(this.humanoid,this.meshAnnotations).copy(this)}get firstPersonOnlyLayer(){return this._firstPersonOnlyLayer}get thirdPersonOnlyLayer(){return this._thirdPersonOnlyLayer}setup({firstPersonOnlyLayer:e=_r.DEFAULT_FIRSTPERSON_ONLY_LAYER,thirdPersonOnlyLayer:t=_r.DEFAULT_THIRDPERSON_ONLY_LAYER}={}){this._initializedLayers||(this._firstPersonOnlyLayer=e,this._thirdPersonOnlyLayer=t,this.meshAnnotations.forEach(n=>{n.meshes.forEach(s=>{n.type==="firstPersonOnly"?(s.layers.set(this._firstPersonOnlyLayer),s.traverse(r=>r.layers.set(this._firstPersonOnlyLayer))):n.type==="thirdPersonOnly"?(s.layers.set(this._thirdPersonOnlyLayer),s.traverse(r=>r.layers.set(this._thirdPersonOnlyLayer))):n.type==="auto"&&this._createHeadlessModel(s)})}),this._initializedLayers=!0)}_excludeTriangles(e,t,n,s){let r=0;if(t!=null&&t.length>0)for(let a=0;a<e.length;a+=3){let o=e[a],c=e[a+1],l=e[a+2],h=t[o],u=n[o];if(h[0]>0&&s.includes(u[0])||h[1]>0&&s.includes(u[1])||h[2]>0&&s.includes(u[2])||h[3]>0&&s.includes(u[3]))continue;let d=t[c],f=n[c];if(d[0]>0&&s.includes(f[0])||d[1]>0&&s.includes(f[1])||d[2]>0&&s.includes(f[2])||d[3]>0&&s.includes(f[3]))continue;let g=t[l],_=n[l];g[0]>0&&s.includes(_[0])||g[1]>0&&s.includes(_[1])||g[2]>0&&s.includes(_[2])||g[3]>0&&s.includes(_[3])||(e[r++]=o,e[r++]=c,e[r++]=l)}return r}_createErasedMesh(e,t){let n=new os(e.geometry.clone(),e.material);n.name=`${e.name}(erase)`,n.frustumCulled=e.frustumCulled,n.layers.set(this._firstPersonOnlyLayer);let s=n.geometry,r=s.getAttribute("skinIndex"),a=r instanceof rr?[]:r.array,o=[];for(let _=0;_<a.length;_+=4)o.push([a[_],a[_+1],a[_+2],a[_+3]]);let c=s.getAttribute("skinWeight"),l=c instanceof rr?[]:c.array,h=[];for(let _=0;_<l.length;_+=4)h.push([l[_],l[_+1],l[_+2],l[_+3]]);let u=s.getIndex();if(!u)throw new Error("The geometry doesn't have an index buffer");let d=Array.from(u.array),f=this._excludeTriangles(d,h,o,t),g=[];for(let _=0;_<f;_++)g[_]=d[_];return s.setIndex(g),e.onBeforeRender&&(n.onBeforeRender=e.onBeforeRender),n.bind(new cs(e.skeleton.bones,e.skeleton.boneInverses),new Le),n}_createHeadlessModelForSkinnedMesh(e,t){let n=[];if(t.skeleton.bones.forEach((r,a)=>{this._isEraseTarget(r)&&n.push(a)}),!n.length){t.layers.enable(this._thirdPersonOnlyLayer),t.layers.enable(this._firstPersonOnlyLayer);return}t.layers.set(this._thirdPersonOnlyLayer);let s=this._createErasedMesh(t,n);e.add(s)}_createHeadlessModel(e){if(e.type==="Group")if(e.layers.set(this._thirdPersonOnlyLayer),this._isEraseTarget(e))e.traverse(t=>t.layers.set(this._thirdPersonOnlyLayer));else{let t=new Nt;t.name=`_headless_${e.name}`,t.layers.set(this._firstPersonOnlyLayer),e.parent.add(t),e.children.filter(n=>n.type==="SkinnedMesh").forEach(n=>{let s=n;this._createHeadlessModelForSkinnedMesh(t,s)})}else if(e.type==="SkinnedMesh"){let t=e;this._createHeadlessModelForSkinnedMesh(e.parent,t)}else this._isEraseTarget(e)&&(e.layers.set(this._thirdPersonOnlyLayer),e.traverse(t=>t.layers.set(this._thirdPersonOnlyLayer)))}_isEraseTarget(e){return e===this.humanoid.getRawBoneNode("head")?!0:e.parent?this._isEraseTarget(e.parent):!1}};Sm.DEFAULT_FIRSTPERSON_ONLY_LAYER=9;Sm.DEFAULT_THIRDPERSON_ONLY_LAYER=10;OE=new L,BE=new L,HE=new ge,hm={hips:null,spine:"hips",chest:"spine",upperChest:"chest",neck:"upperChest",head:"neck",leftEye:"head",rightEye:"head",jaw:"head",leftUpperLeg:"hips",leftLowerLeg:"leftUpperLeg",leftFoot:"leftLowerLeg",leftToes:"leftFoot",rightUpperLeg:"hips",rightLowerLeg:"rightUpperLeg",rightFoot:"rightLowerLeg",rightToes:"rightFoot",leftShoulder:"upperChest",leftUpperArm:"leftShoulder",leftLowerArm:"leftUpperArm",leftHand:"leftLowerArm",rightShoulder:"upperChest",rightUpperArm:"rightShoulder",rightLowerArm:"rightUpperArm",rightHand:"rightLowerArm",leftThumbMetacarpal:"leftHand",leftThumbProximal:"leftThumbMetacarpal",leftThumbDistal:"leftThumbProximal",leftIndexProximal:"leftHand",leftIndexIntermediate:"leftIndexProximal",leftIndexDistal:"leftIndexIntermediate",leftMiddleProximal:"leftHand",leftMiddleIntermediate:"leftMiddleProximal",leftMiddleDistal:"leftMiddleIntermediate",leftRingProximal:"leftHand",leftRingIntermediate:"leftRingProximal",leftRingDistal:"leftRingIntermediate",leftLittleProximal:"leftHand",leftLittleIntermediate:"leftLittleProximal",leftLittleDistal:"leftLittleIntermediate",rightThumbMetacarpal:"rightHand",rightThumbProximal:"rightThumbMetacarpal",rightThumbDistal:"rightThumbProximal",rightIndexProximal:"rightHand",rightIndexIntermediate:"rightIndexProximal",rightIndexDistal:"rightIndexIntermediate",rightMiddleProximal:"rightHand",rightMiddleIntermediate:"rightMiddleProximal",rightMiddleDistal:"rightMiddleIntermediate",rightRingProximal:"rightHand",rightRingIntermediate:"rightRingProximal",rightRingDistal:"rightRingIntermediate",rightLittleProximal:"rightHand",rightLittleIntermediate:"rightLittleProximal",rightLittleDistal:"rightLittleIntermediate"};zE=new L,VE=new ge,GE=new L,WE=new ge,qE=new L,XE=new ge,jE=new ge,YE=new L,KE=new L,um=Math.sqrt(2)/2,JE=new ge(0,0,-um,um),$E=new L(0,1,0),Nw=new L,Uw=new L;fm=new L(0,0,1),Ow=new L,Bw=new L,Hw=new L,zw=new ge,Nu=new ge,pm=new ge,Vw=new ge,Uu=new Bt,Am=class Em{constructor(e,t){this.offsetFromHeadBone=new L,this.autoUpdate=!0,this.faceFront=new L(0,0,1),this.humanoid=e,this.applier=t,this._yaw=0,this._pitch=0,this._needsUpdate=!0,this._restHeadWorldQuaternion=this.getLookAtWorldQuaternion(new ge)}get yaw(){return this._yaw}set yaw(e){this._yaw=e,this._needsUpdate=!0}get pitch(){return this._pitch}set pitch(e){this._pitch=e,this._needsUpdate=!0}get euler(){return console.warn("VRMLookAt: euler is deprecated. use getEuler() instead."),this.getEuler(new Bt)}getEuler(e){return e.set(_t.DEG2RAD*this._pitch,_t.DEG2RAD*this._yaw,0,"YXZ")}copy(e){if(this.humanoid!==e.humanoid)throw new Error("VRMLookAt: humanoid must be same in order to copy");return this.offsetFromHeadBone.copy(e.offsetFromHeadBone),this.applier=e.applier,this.autoUpdate=e.autoUpdate,this.target=e.target,this.faceFront.copy(e.faceFront),this}clone(){return new Em(this.humanoid,this.applier).copy(this)}reset(){this._yaw=0,this._pitch=0,this._needsUpdate=!0}getLookAtWorldPosition(e){let t=this.humanoid.getRawBoneNode("head");return e.copy(this.offsetFromHeadBone).applyMatrix4(t.matrixWorld)}getLookAtWorldQuaternion(e){let t=this.humanoid.getRawBoneNode("head");return Hu(t,e)}getFaceFrontQuaternion(e){if(this.faceFront.distanceToSquared(fm)<.01)return e.copy(this._restHeadWorldQuaternion).invert();let[t,n]=Yc(this.faceFront);return Uu.set(0,.5*Math.PI+t,n,"YZX"),e.setFromEuler(Uu).premultiply(Vw.copy(this._restHeadWorldQuaternion).invert())}getLookAtWorldDirection(e){return this.getLookAtWorldQuaternion(Nu),this.getFaceFrontQuaternion(pm),e.copy(fm).applyQuaternion(Nu).applyQuaternion(pm).applyEuler(this.getEuler(Uu))}lookAt(e){let t=zw.copy(this._restHeadWorldQuaternion).multiply(Fw(this.getLookAtWorldQuaternion(Nu))),n=this.getLookAtWorldPosition(Bw),s=Hw.copy(e).sub(n).applyQuaternion(t).normalize(),[r,a]=Yc(this.faceFront),[o,c]=Yc(s),l=dm(o-r),h=dm(a-c);this._yaw=_t.RAD2DEG*l,this._pitch=_t.RAD2DEG*h,this._needsUpdate=!0}update(e){this.target!=null&&this.autoUpdate&&this.lookAt(this.target.getWorldPosition(Ow)),this._needsUpdate&&(this._needsUpdate=!1,this.applier.applyYawPitch(this._yaw,this._pitch))}};Am.EULER_ORDER="YXZ";Gw=Am,Ww=new L(0,0,1),ii=new ge,gr=new ge,En=new Bt(0,0,0,"YXZ"),qw=class{constructor(i,e,t,n,s){this.humanoid=i,this.rangeMapHorizontalInner=e,this.rangeMapHorizontalOuter=t,this.rangeMapVerticalDown=n,this.rangeMapVerticalUp=s,this.faceFront=new L(0,0,1),this._restQuatLeftEye=new ge,this._restQuatRightEye=new ge,this._restLeftEyeParentWorldQuat=new ge,this._restRightEyeParentWorldQuat=new ge;let r=this.humanoid.getRawBoneNode("leftEye"),a=this.humanoid.getRawBoneNode("rightEye");r&&(this._restQuatLeftEye.copy(r.quaternion),Hu(r.parent,this._restLeftEyeParentWorldQuat)),a&&(this._restQuatRightEye.copy(a.quaternion),Hu(a.parent,this._restRightEyeParentWorldQuat))}applyYawPitch(i,e){let t=this.humanoid.getRawBoneNode("leftEye"),n=this.humanoid.getRawBoneNode("rightEye"),s=this.humanoid.getNormalizedBoneNode("leftEye"),r=this.humanoid.getNormalizedBoneNode("rightEye");t&&(e<0?En.x=-_t.DEG2RAD*this.rangeMapVerticalDown.map(-e):En.x=_t.DEG2RAD*this.rangeMapVerticalUp.map(e),i<0?En.y=-_t.DEG2RAD*this.rangeMapHorizontalInner.map(-i):En.y=_t.DEG2RAD*this.rangeMapHorizontalOuter.map(i),ii.setFromEuler(En),this._getWorldFaceFrontQuat(gr),s.quaternion.copy(gr).multiply(ii).multiply(gr.invert()),ii.copy(this._restLeftEyeParentWorldQuat),t.quaternion.copy(s.quaternion).multiply(ii).premultiply(ii.invert()).multiply(this._restQuatLeftEye)),n&&(e<0?En.x=-_t.DEG2RAD*this.rangeMapVerticalDown.map(-e):En.x=_t.DEG2RAD*this.rangeMapVerticalUp.map(e),i<0?En.y=-_t.DEG2RAD*this.rangeMapHorizontalOuter.map(-i):En.y=_t.DEG2RAD*this.rangeMapHorizontalInner.map(i),ii.setFromEuler(En),this._getWorldFaceFrontQuat(gr),r.quaternion.copy(gr).multiply(ii).multiply(gr.invert()),ii.copy(this._restRightEyeParentWorldQuat),n.quaternion.copy(r.quaternion).multiply(ii).premultiply(ii.invert()).multiply(this._restQuatRightEye))}lookAt(i){console.warn("VRMLookAtBoneApplier: lookAt() is deprecated. use apply() instead.");let e=_t.RAD2DEG*i.y,t=_t.RAD2DEG*i.x;this.applyYawPitch(e,t)}_getWorldFaceFrontQuat(i){if(this.faceFront.distanceToSquared(Ww)<.01)return i.identity();let[e,t]=Yc(this.faceFront);return En.set(0,.5*Math.PI+e,t,"YZX"),i.setFromEuler(En)}};qw.type="bone";Xw=class{constructor(i,e,t,n,s){this.expressions=i,this.rangeMapHorizontalInner=e,this.rangeMapHorizontalOuter=t,this.rangeMapVerticalDown=n,this.rangeMapVerticalUp=s}applyYawPitch(i,e){e<0?(this.expressions.setValue("lookDown",0),this.expressions.setValue("lookUp",this.rangeMapVerticalUp.map(-e))):(this.expressions.setValue("lookUp",0),this.expressions.setValue("lookDown",this.rangeMapVerticalDown.map(e))),i<0?(this.expressions.setValue("lookLeft",0),this.expressions.setValue("lookRight",this.rangeMapHorizontalOuter.map(-i))):(this.expressions.setValue("lookRight",0),this.expressions.setValue("lookLeft",this.rangeMapHorizontalOuter.map(i)))}lookAt(i){console.warn("VRMLookAtBoneApplier: lookAt() is deprecated. use apply() instead.");let e=_t.RAD2DEG*i.y,t=_t.RAD2DEG*i.x;this.applyYawPitch(e,t)}};Xw.type="expression";mm=180/Math.PI,Ou=new Bt,zu=class extends rt{constructor(i){super(),this.vrmLookAt=i,this.type="VRMLookAtQuaternionProxy";let e=this.rotation._onChangeCallback;this.rotation._onChange(()=>{e(),this._applyToLookAt()});let t=this.quaternion._onChangeCallback;this.quaternion._onChange(()=>{t(),this._applyToLookAt()})}_applyToLookAt(){Ou.setFromQuaternion(this.quaternion,Gw.EULER_ORDER),this.vrmLookAt.yaw=mm*Ou.y,this.vrmLookAt.pitch=mm*Ou.x}};Lm=class{constructor(){this.duration=0,this.restHipsPosition=new L,this.humanoidTracks={translation:new Map,rotation:new Map},this.expressionTracks={preset:new Map,custom:new Map},this.lookAtTrack=null}};Yw=new Le,Ma=new L,Bu=new ge,_m=new ge,Kw=new ge,Jw=new Set(["1.0","1.0-draft"]),$w=new Set(Object.values(Kc)),Zw=class{constructor(i){this.parser=i}get name(){return"VRMC_vrm_animation"}afterRoot(i){return nm(this,null,function*(){var e,t,n;let s=i.parser.json,r=s.extensionsUsed;if(r==null||r.indexOf(this.name)==-1)return;let a=(e=s.extensions)==null?void 0:e[this.name];if(a==null)return;let o=a.specVersion;if(o==null)console.warn("VRMAnimationLoaderPlugin: specVersion of the VRMA is not defined. Consider updating the animation file. Assuming the spec version is 1.0.");else{if(!Jw.has(o)){console.warn(`VRMAnimationLoaderPlugin: Unknown VRMC_vrm_animation spec version: ${o}`);return}o==="1.0-draft"&&console.warn("VRMAnimationLoaderPlugin: Using a draft spec version: 1.0-draft. Some behaviors may be different. Consider updating the animation file.")}let c=this._createNodeMap(a),l=yield this._createBoneWorldMatrixMap(i,a),h=(n=(t=a.humanoid)==null?void 0:t.humanBones.hips)==null?void 0:n.node,u=h!=null?yield i.parser.getDependency("node",h):null,d=new L;u?.getWorldPosition(d),d.y<.001&&console.warn("VRMAnimationLoaderPlugin: The loaded VRM Animation might violate the VRM T-pose (The y component of the rest hips position is approximately zero or below.)");let g=i.animations.map((_,m)=>{let p=s.animations[m],x=this._parseAnimation(_,p,c,l);return x.restHipsPosition=d,x});i.userData.vrmAnimations=g})}_createNodeMap(i){var e,t,n,s,r;let a=new Map,o=new Map,c=(e=i.humanoid)==null?void 0:e.humanBones;c&&Object.entries(c).forEach(([d,f])=>{let g=f?.node;g!=null&&a.set(g,d)});let l=(t=i.expressions)==null?void 0:t.preset;l&&Object.entries(l).forEach(([d,f])=>{let g=f?.node;g!=null&&o.set(g,d)});let h=(n=i.expressions)==null?void 0:n.custom;h&&Object.entries(h).forEach(([d,f])=>{let{node:g}=f;o.set(g,d)});let u=(r=(s=i.lookAt)==null?void 0:s.node)!=null?r:null;return{humanoidIndexToName:a,expressionsIndexToName:o,lookAtIndex:u}}_createBoneWorldMatrixMap(i,e){return nm(this,null,function*(){var t,n;i.scene.updateWorldMatrix(!1,!0);let s=yield i.parser.getDependencies("node"),r=new Map;if(e.humanoid==null)return r;for(let[a,o]of Object.entries(e.humanoid.humanBones)){let c=o?.node;if(c!=null){let l=s[c];r.set(a,l.matrixWorld),a==="hips"&&r.set("hipsParent",(n=(t=l.parent)==null?void 0:t.matrixWorld)!=null?n:Yw)}}return r})}_parseAnimation(i,e,t,n){let s=i.tracks,r=e.channels,a=new Lm;return a.duration=i.duration,r.forEach((o,c)=>{let{node:l,path:h}=o.target,u=s[c];if(l==null)return;let d=t.humanoidIndexToName.get(l);if(d!=null){let g=hm[d];for(;g!=null&&n.get(g)==null;)g=hm[g];if(g==null&&(g="hipsParent"),h==="translation")if(d!=="hips")console.warn(`The loading animation contains a translation track for ${d}, which is not permitted in the VRMC_vrm_animation spec. ignoring the track`);else{let _=n.get("hipsParent"),m=gm(u.values,3).flatMap(x=>Ma.fromArray(x).applyMatrix4(_).toArray()),p=u.clone();p.values=new Float32Array(m),a.humanoidTracks.translation.set(d,p)}else if(h==="rotation"){let _=n.get(d),m=n.get(g);_.decompose(Ma,Bu,Ma),Bu.invert(),m.decompose(Ma,_m,Ma);let p=gm(u.values,4).flatMap(y=>Kw.fromArray(y).premultiply(_m).multiply(Bu).toArray()),x=u.clone();x.values=new Float32Array(p),a.humanoidTracks.rotation.set(d,x)}else throw new Error(`Invalid path "${h}"`);return}let f=t.expressionsIndexToName.get(l);if(f!=null){if(h==="translation"){let g=u.times,_=new Float32Array(u.values.length/3);for(let p=0;p<_.length;p++)_[p]=u.values[3*p];let m=new Mn(`${f}.weight`,g,_);$w.has(f)?a.expressionTracks.preset.set(f,m):a.expressionTracks.custom.set(f,m)}else throw new Error(`Invalid path "${h}"`);return}if(l===t.lookAtIndex)if(h==="rotation")a.lookAtTrack=u;else throw new Error(`Invalid path "${h}"`)}),a}};});function eM(i,e,t){if(!i||!e||!t)return null;let n=t.get("Hips");if(!n)return null;let s=e.getObjectByName(n);if(!s)return null;let r=i.tracks.find(d=>d.name===`${n}.quaternion`);if(!r||r.values.length<4)return null;let a=r.values,o=s.quaternion.x,c=s.quaternion.y,l=s.quaternion.z,h=s.quaternion.w;s.quaternion.set(a[0],a[1],a[2],a[3]),s.updateWorldMatrix(!0,!1),s.getWorldQuaternion(Dm),km.copy(Fm).applyQuaternion(Dm),s.quaternion.set(o,c,l,h),s.updateWorldMatrix(!0,!1);let u=Math.max(-1,Math.min(1,km.dot(Fm)));return Math.acos(u)*180/Math.PI}function iM(i){let e=!1,t=new Set;return i.traverse(n=>{if(n.isSkinnedMesh&&(e=!0),n.name){let s=_n(n.name);s&&t.add(s)}}),e&&t.size>=tM}function sM(i){try{let e=typeof window<"u"&&typeof window.reportClientError=="function"?window.reportClientError:null;if(!e)return;e(new Error("fallen-pose retarget"),i)}catch(e){bn.warn("[AnimationManager] fallen-pose report failed:",e)}}var Qw,km,Dm,Fm,tM,nM,Nm,Jc,Sa,Um=ct(()=>{"use strict";lt();Vc();jp();em();tm();Qw=45,km=new L,Dm=new ge,Fm=new L(0,1,0);tM=8,nM=Object.freeze(["Hips","LeftUpLeg","LeftLeg","LeftFoot","LeftToeBase","RightUpLeg","RightLeg","RightFoot","RightToeBase"]),Nm=.35,Jc=new Map,Sa=class i{constructor(){this.model=null,this.mixer=null,this.clips=new Map,this.actions=new Map,this.currentName=null,this.currentAction=null,this.onChange=null,this._animationDefs=[],this._failed=new Set,this._canonicalToNode=null,this._canonicalClipsSupported=!1,this._vrm=null,this._avatarContext={},this._fallenReported=new Set,this._fallen=new Set,this._latestCrossfadeTarget=null,this.overlayAction=null,this.overlayName=null,this._overlayClips=new Map,this._overlayFinishHandler=null,this._settleFinishHandler=null}setAvatarContext(e){this._avatarContext=e&&typeof e=="object"?{...e}:{}}attach(e,t){this.detach(),t&&this.setAvatarContext(t),this.model=e,this.mixer=new us(e),this.actions.clear(),this.currentAction=null,this.currentName=null,this._fallen.clear(),this._canonicalToNode=Op(e),this._canonicalRest=Bp(e),this._canonicalWorldRest=Hp(e),this._canonicalRestDirections=zp(e),this._hipsParentWorldQuat=Gp(e),this._morphTargets=Vp(e),this._hipTargetLocalY=Iu(e),this._hipGroundLocalY=ku(e),this._canonicalClipsSupported=iM(e),this._vrm=e?.userData?.vrm||null;for(let[n,s]of this.clips){let r=this._retarget(s);if(!r)continue;let a=this.mixer.clipAction(r);a.enabled=!0,this.actions.set(n,a)}}remeasureRigProportions(){if(!this.model||!this.mixer)return!1;let e=this.currentName;this._hipTargetLocalY=Iu(this.model),this._hipGroundLocalY=ku(this.model),this.mixer.stopAllAction();for(let t of this.actions.values()){let n=t.getClip?.();n&&this.mixer.uncacheClip(n)}this.actions.clear(),this.currentAction=null,this.currentName=null,this._latestCrossfadeTarget=null,this.overlayAction=null,this.overlayName=null,this._overlayClips.clear(),this._detachOverlayFinish?.();for(let[t,n]of this.clips){let s=this._retarget(n);if(!s)continue;let r=this.mixer.clipAction(s);r.enabled=!0,this.actions.set(t,r)}return e&&this.actions.has(e)&&this.play(e),!0}_retarget(e){if(!this._canonicalToNode||this._canonicalToNode.size===0)return null;let t=1,n=qp(e);this._hipTargetLocalY>.05&&n>.05&&(t=Math.min(200,Math.max(.2,this._hipTargetLocalY/n)));let{clip:s}=Xp(e,this._canonicalToNode,{targetRest:this._canonicalRest,targetWorldRest:this._canonicalWorldRest,targetRestDirections:this._canonicalRestDirections,hipsParentWorldQuat:this._hipsParentWorldQuat,morphTargets:this._morphTargets,hipScale:t,hipOffsetY:this._hipGroundLocalY||0});return s}_guardAgainstFallenPose(e,t){if(this._fallen.has(e))return!1;let n=t?.getClip?.(),s=eM(n,this.model,this._canonicalToNode);if(s==null||!Number.isFinite(s)||s<=Qw)return!0;try{t.stop()}catch(c){bn.warn("[AnimationManager] failed to stop fallen-pose action:",c)}t.enabled=!1,this.actions.delete(e),this._fallen.add(e),this.currentAction===t&&(this.currentAction=null,this.currentName=null);let r=this._avatarContext.avatarUrl||"",a=this._avatarContext.avatarId||"",o=`${a||r}|${e}`;return this._fallenReported.has(o)||(this._fallenReported.add(o),bn.warn(`[AnimationManager] "${e}" retargeted to a fallen pose (${s.toFixed(1)}\xB0 off vertical) \u2014 falling back to bind pose`),sM({avatarId:a,avatarUrl:r,clip:e,tiltDeg:Math.round(s*10)/10})),!1}detach(){this.mixer&&(this.mixer.stopAllAction(),this.mixer.uncacheRoot(this.mixer.getRoot()),this.mixer=null),this.model=null,this._canonicalToNode=null,this._canonicalRest=null,this._canonicalWorldRest=null,this._canonicalRestDirections=null,this._hipsParentWorldQuat=null,this._morphTargets=null,this._hipTargetLocalY=0,this._hipGroundLocalY=0,this._canonicalClipsSupported=!1,this._vrm=null,this.actions.clear(),this.currentAction=null,this.currentName=null,this._latestCrossfadeTarget=null,this._fallen.clear(),this.overlayAction=null,this.overlayName=null,this._overlayClips.clear(),this._overlayFinishHandler=null}setAnimationDefs(e){this._animationDefs=e}appendAnimationDefs(e){let t=new Set(this._animationDefs.map(n=>n.name));for(let n of e)t.has(n.name)||(this._animationDefs.push(n),t.add(n.name))}getAnimationDefs(){return this._animationDefs}isFailed(e){return this._failed.has(e)}supportsCanonicalClips(){return this._canonicalClipsSupported}relaxUndrivenArms(){return this.model?Qp(this.model,this._canonicalToNode):0}canPlay(e){return this._fallen.has(e)?!1:this.clips.has(e)?!0:this._failed.has(e)?!1:this._animationDefs.some(t=>t.name===e)}async loadAnimation(e,t,n={}){if(this.clips.has(e))return this.clips.get(e);let s=Jc.get(t);s||(s=i._fetchClip(e,t),Jc.set(t,s),s.catch(()=>{Jc.get(t)===s&&Jc.delete(t)}));let r=await s;return this._registerParsedClip(e,r,n)}static async _fetchClip(e,t){let n=t.includes("/api/animations/"),s=new AbortController,r=setTimeout(()=>s.abort(),15e3),a;try{a=await fetch(t,{signal:s.signal,credentials:n?"include":"same-origin",redirect:"error"})}finally{clearTimeout(r)}if(!a.ok)throw new Error(`HTTP ${a.status} loading animation ${e}`);let o=await a.json(),c=n?o?.clip?.clip:o;if(!c&&o?.clip?.paywalled)throw new Error(`animation ${e} is a paid clip, unlock it at ${o.clip.download_url}`);if(!c)throw new Error(`clip payload missing from ${t}`);let l=$t.parse(c);return l.name=e,l}injectClip(e,t,n={}){if(!(!t||this.clips.has(e)))try{let s=$t.parse(t);s.name=e,this._registerParsedClip(e,s,n)}catch(s){bn.warn(`[AnimationManager] injectClip "${e}" parse error:`,s.message)}}async loadVrmaAnimation(e,t,n={}){if(this.clips.has(e))return this.clips.get(e);let[{GLTFLoader:s},{VRMAnimationLoaderPlugin:r}]=await Promise.all([Promise.resolve().then(()=>(Tu(),Ap)),Promise.resolve().then(()=>(Im(),Pm))]),a=new s;a.register(u=>new r(u));let c=(await a.loadAsync(t)).userData?.vrmAnimations?.[0];if(!c)throw new Error(`${t} has no VRM animation data`);let l=[];for(let[u,d]of c.humanoidTracks.rotation.entries()){let f=d.clone();f.name=`${u}.quaternion`,l.push(f)}for(let[u,d]of c.humanoidTracks.translation.entries()){let f=d.clone();f.name=`${u}.position`,l.push(f)}if(!l.length)throw new Error(`${t} has no humanoid bone tracks`);let h=new $t(e,c.duration,l);return this._registerParsedClip(e,h,n)}_registerParsedClip(e,t,n){if(this.clips.set(e,t),this.model&&this.mixer){let s=this._retarget(t);if(s){let r=this.mixer.clipAction(s);r.enabled=!0,r.setLoop(n.loop===!1?zi:ps),n.loop===!1&&(r.clampWhenFinished=!0),this.actions.set(e,r)}}return t}async loadAll(){let t=[...this._animationDefs],n=async()=>{let s;for(;s=t.shift();)try{await this.loadAnimation(s.name,s.url,{loop:s.loop!==!1})}catch(r){bn.warn(`[AnimationManager] failed to load "${s.name}":`,r.message),this._failed.add(s.name)}};await Promise.all(Array.from({length:4},n))}async ensureLoaded(e){if(this.clips.has(e))return!0;if(this._failed.has(e))return!1;let t=this._animationDefs.find(n=>n.name===e);if(!t)return!1;try{return await this.loadAnimation(t.name,t.url,{loop:t.loop!==!1}),!0}catch{return this._failed.add(e),!1}}async play(e){if(!await this.ensureLoaded(e))return(this._failed.has(e)||this._animationDefs.some(s=>s.name===e))&&bn.warn(`[AnimationManager] "${e}" unavailable`),!1;if(e===this.currentName)return!0;let n=this.actions.get(e);if(!n||!this._guardAgainstFallenPose(e,n))return!1;this.currentAction&&this.currentAction!==n&&this.currentAction.fadeOut(.01),n.reset().fadeIn(.01).play(),this.currentAction=n,this.currentName=e;try{this.onChange?.(e)}catch(s){bn.warn("[AnimationManager] onChange threw:",s)}return!0}async playOnce(e,{settleTo:t="idle",fade:n=Nm,fadeIn:s=n}={}){n=Math.max(0,Math.min(n,5)),s=Math.max(0,Math.min(s,5));let a=await this.ensureLoaded(e)?this.actions.get(e):null;if(!a||!this._guardAgainstFallenPose(e,a))return t?this.crossfadeTo(t,s):void 0;if(a.reset(),a.setLoop(zi,1),a.clampWhenFinished=!0,a.play(),this.currentAction&&this.currentAction!==a?this.currentAction.crossFadeTo(a,s,!0):a.fadeIn(s),this.currentAction=a,this.currentName=e,this._settleFinishHandler&&this.mixer&&(this.mixer.removeEventListener("finished",this._settleFinishHandler),this._settleFinishHandler=null),t&&this.mixer){let o=c=>{c.action===a&&(this.mixer.removeEventListener("finished",o),this._settleFinishHandler===o&&(this._settleFinishHandler=null),this.currentAction===a&&this.crossfadeTo(t,n))};this._settleFinishHandler=o,this.mixer.addEventListener("finished",o)}try{this.onChange?.(e)}catch(o){bn.warn("[AnimationManager] onChange threw:",o)}}freeze(){this.currentAction&&(this.currentAction.paused=!0),this.currentAction=null,this.currentName=null,this._latestCrossfadeTarget=null}async crossfadeTo(e,t=Nm){if(t=Math.max(0,Math.min(t,5)),e===this.currentName)return;if(this._latestCrossfadeTarget=e,!await this.ensureLoaded(e)){(this._failed.has(e)||this._animationDefs.some(r=>r.name===e))&&bn.warn(`[AnimationManager] "${e}" unavailable`);return}if(this._latestCrossfadeTarget!==e||e===this.currentName)return;let s=this.actions.get(e);if(s&&this._guardAgainstFallenPose(e,s)){s.reset().play(),this.currentAction&&this.currentAction!==s?this.currentAction.crossFadeTo(s,t,!0):s.fadeIn(t),this.currentAction=s,this.currentName=e;try{this.onChange?.(e)}catch(r){bn.warn("[AnimationManager] onChange threw:",r)}}}_buildOverlayClip(e,t){let n=`${e}|${t?"upper":"full"}`,s=this._overlayClips.get(n);if(s)return s;let r=this.clips.get(e);if(!r)return null;let a=this._retarget(r);if(!a)return null;let o=a.tracks;if(t&&this._canonicalToNode){let l=new Set;for(let h of nM){let u=this._canonicalToNode.get(h);u&&l.add(u)}if(o=o.filter(h=>{let u=h.name.split(".")[0];return!l.has(u)}),o.length===0)return null}let c=new $t(`${e}__additive`,a.duration,o);return Kr.makeClipAdditive(c),this._overlayClips.set(n,c),c}async playOverlay(e,{loop:t=!1,crossfade:n=.25,upperBodyOnly:s=!0,timeScale:r=1,onFinished:a=null}={}){if(n=Math.max(0,Math.min(n,5)),!await this.ensureLoaded(e)||!this.mixer)return!1;let c=this._buildOverlayClip(e,s);if(!c)return!1;let l=this.mixer.clipAction(c,void 0,da);this._detachOverlayFinish();let h=this.overlayAction;if(h&&h!==l&&h.fadeOut(n),l.enabled=!0,l.setLoop(t?ps:zi,t?1/0:1),l.clampWhenFinished=!t,l.setEffectiveTimeScale(r),l.reset(),l.setEffectiveWeight(1),l.fadeIn(n),l.play(),this.overlayAction=l,this.overlayName=e,!t){let u=d=>{if(d.action===l){this.mixer.removeEventListener("finished",u),this._overlayFinishHandler===u&&(this._overlayFinishHandler=null),this.overlayAction===l&&(l.fadeOut(n),this.overlayAction=null,this.overlayName=null);try{a?.(e)}catch(f){bn.warn("[AnimationManager] overlay onFinished threw:",f)}}};this._overlayFinishHandler=u,this.mixer.addEventListener("finished",u)}return!0}_detachOverlayFinish(){this._overlayFinishHandler&&this.mixer&&this.mixer.removeEventListener("finished",this._overlayFinishHandler),this._overlayFinishHandler=null}stopOverlay({crossfade:e=.2}={}){e=Math.max(0,Math.min(e,5)),this._detachOverlayFinish(),this.overlayAction&&(this.overlayAction.fadeOut(e),this.overlayAction=null,this.overlayName=null)}hasOverlay(){return this.overlayAction!=null}setSpeed(e){this.currentAction?.setEffectiveTimeScale(e)}stopAll(){this.mixer?.stopAllAction(),this._detachOverlayFinish(),this.currentAction=null,this.currentName=null,this.overlayAction=null,this.overlayName=null;try{this.onChange?.(null)}catch(e){bn.warn("[AnimationManager] onChange threw:",e)}}update(e){this.mixer?.update(e),this._vrm?.update(e)}getLoadedNames(){return[...this.clips.keys()]}isLoaded(e){return this.clips.has(e)}dispose(){this.detach(),this.clips.clear(),this._animationDefs=[],this._failed.clear()}}});var Om=ct(()=>{"use strict";Vc()});var Bm=ct(()=>{"use strict"});var rM,vT,yT,wT,MT,ST,AT,ET,TT,RT,CT,LT,Hm=ct(()=>{"use strict";lt();Om();Bm();rM=Math.PI/180,vT=120*rM,yT=new L,wT=new L,MT=new ge,ST=new ge,AT=new ge,ET=new ge,TT=new ge,RT=new ge,CT=new ge,LT=new Bt});var Vu=ct(()=>{"use strict";Um();Hm()});function zm(i,e,t){let n=new URL(e,t||(typeof location<"u"?location.href:"http://localhost/"));return i.map(s=>s&&typeof s.url=="string"?{...s,url:new URL(s.url,n).href}:s)}var Vm=ct(()=>{"use strict"});function Zc(i){return i&&oM.get(i)||null}function Wu(i,{name:e,accent:t}={}){return{id:i,name:e||"Your avatar",emoji:"\u2728",blurb:"Your own avatar, retargeted to the shared motion library.",category:"Yours",asset:null,source:"api",rig:"shared",clips:zn,accent:t||"#7aa2ff",tags:["custom","user"]}}function Qc(i,{assetBase:e="",apiBase:t=""}={}){return i?i.source==="api"?`${t}/api/avatars/${encodeURIComponent(i.id)}/glb`:i.asset?/^https?:\/\//i.test(i.asset)?i.asset:`${e}${i.asset}`:null:null}var Gu,zn,Aa,$c,oM,el=ct(()=>{"use strict";Gu="robot",zn={idle:"idle",walk:"av-walk-feminine",run:"av-walk-feminine",wave:"wave",jump:"jump"},Aa={dance:"dance",punch:"av-muay-thai",backflip:"av-back-flip",wave:"wave"},$c=[{id:"robot",name:"Robo",emoji:"\u{1F916}",blurb:"The friendly platform mascot. Expressive, lightweight, always game.",category:"Mascots",asset:"/animations/robotexpressive.glb",source:"static",rig:"embedded",thumb:"/avatars/thumbs/robotexpressive.png",accent:"#7aa2ff",tags:["mascot","robot","lightweight","default"]},{id:"guide",name:"Guide",emoji:"\u{1F9ED}",blurb:"A clean humanoid guide, driven by the shared motion library.",category:"Humanoid",asset:"/avatars/default.glb",source:"static",rig:"shared",clips:zn,thumb:"/avatars/thumbs/default.png",accent:"#8bd5ca",tags:["humanoid","neutral","guide"]},{id:"michelle",name:"Michelle",emoji:"\u{1F483}",blurb:"Stylised dancer rig, fully retargeted so she struts \u2014 never poses.",category:"Humanoid",asset:"/avatars/michelle.glb",source:"static",rig:"shared",clips:{...zn,wave:"michelle-samba-dance"},emotes:{...Aa,dance:"michelle-samba-dance"},accent:"#ff8fab",tags:["humanoid","feminine","dancer"]},{id:"mannequin",name:"Mannequin",emoji:"\u{1F9CD}",blurb:"A neutral artist mannequin \u2014 the blank canvas of the cast.",category:"Humanoid",asset:"/avatars/mannequin.glb",source:"static",rig:"shared",clips:zn,accent:"#c9b8a8",tags:["humanoid","neutral","mannequin"]},{id:"xbot",name:"X-Bot",emoji:"\u{1F9BE}",blurb:"Mixamo X-Bot with its own idle/walk/run set for snappy motion.",category:"Humanoid",asset:"/avatars/xbot.glb",source:"static",rig:"shared",clips:{idle:"xbot-idle",walk:"xbot-walk",run:"xbot-run",wave:"wave",jump:"jump"},accent:"#9aa7b5",tags:["humanoid","robot","mixamo"]},{id:"realistic-female",name:"Ava",emoji:"\u{1F469}",blurb:"Photoreal full-body avatar, retargeted to the shared library.",category:"Realistic",asset:"/avatars/realistic-female.glb",source:"static",rig:"shared",clips:zn,accent:"#f2a65a",tags:["realistic","feminine","rpm"]},{id:"realistic-male",name:"Leo",emoji:"\u{1F468}",blurb:"Photoreal full-body avatar, retargeted to the shared library.",category:"Realistic",asset:"/avatars/realistic-male.glb",source:"static",rig:"shared",clips:zn,accent:"#6ea8fe",tags:["realistic","masculine","rpm"]},{id:"selfie-girl",name:"Mira",emoji:"\u{1F933}",blurb:"Selfie-styled avatar \u2014 playful, expressive, photo-ready.",category:"Realistic",asset:"/avatars/selfie-girl.glb",source:"static",rig:"shared",clips:zn,accent:"#d39bff",tags:["realistic","feminine","rpm"]},{id:"fox",name:"Fox",emoji:"\u{1F98A}",blurb:"The classic glTF fox \u2014 a non-humanoid pal that trots and surveys.",category:"Creatures",asset:"/avatars/fox.glb",source:"static",rig:"embedded",clips:{idle:["Survey"],walk:["Walk"],run:["Run"]},accent:"#ff9f43",tags:["creature","animal","quadruped"]},{id:"twerk",name:"Groove",emoji:"\u{1F57A}",blurb:"A dancer who never stops moving \u2014 pure ambient energy.",category:"Showpieces",asset:"/avatars/dancing-twerk.glb",source:"static",rig:"embedded",accent:"#ff5e7e",tags:["dancer","loop","fun"]},{id:"cesium",name:"Cesium",emoji:"\u{1F6B6}",blurb:"The reference walking man \u2014 a tireless, steady stroller.",category:"Showpieces",asset:"/avatars/cesium-man.glb",source:"static",rig:"embedded",accent:"#54c7ec",tags:["reference","walk"]},{id:"brainstem",name:"Stem",emoji:"\u{1F9BF}",blurb:"A skeletal showpiece rig with a hypnotic walk cycle.",category:"Showpieces",asset:"/avatars/brainstem.glb",source:"static",rig:"embedded",accent:"#a0e7a0",tags:["showpiece","skeletal"]},{id:"cz",name:"CZ",emoji:"\u{1F9D1}\u200D\u{1F4BC}",blurb:"A stylised character bust with a calm, animated idle.",category:"Showpieces",asset:"/avatars/cz.glb",source:"static",rig:"embedded",thumb:"/avatars/thumbs/cz.png",accent:"#ffd166",tags:["showpiece","idle"]}],oM=new Map($c.map(i=>[i.id,i]))});function qm(i,e=Aa){let t=new Set(i),n={};for(let[s,r]of Object.entries(e))r&&t.has(r)&&(n[s]=r);return n}async function hM(){return qu||(qu=(async()=>{let i=new ba;return i.setMeshoptDecoder(await Rp()),i})()),qu}async function vs(i,e={}){let{assetBase:t="",apiBase:n="",manifestUrl:s="/animations/manifest.json",fallbackEntry:r=null,waveMs:a=cM}=e,o=await hM(),c=Qc(i,{assetBase:t,apiBase:n});if(!c)throw new Error(`walk: cannot resolve a GLB url for avatar "${i?.id}"`);let l=i,h;try{h=await o.loadAsync(c)}catch(f){if(r&&r.id!==i.id)Hn.warn(`avatar "${i?.id}" failed to load \u2014 falling back to "${r.id}"`,f?.message||f),l=r,h=await o.loadAsync(Qc(r,{assetBase:t,apiBase:n}));else throw f}let u=h.scene;u.traverse(f=>{f.isMesh&&(f.frustumCulled=!1)});let d;try{l.rig==="shared"?d=await uM(u,l.clips||zn,{manifestUrl:s,waveMs:a,emotes:l.emotes}):d=Gm(u,h.animations||[],l.clips||{},{waveMs:a})}catch(f){if(f?.code===Xm)if(h.animations&&h.animations.length)Hn.debug(`avatar "${l.id}" isn't a retargetable humanoid \u2014 driving its ${h.animations.length} baked clip(s) instead`),d=Gm(u,h.animations,{},{waveMs:a});else{if(r&&r.id!==l.id)return Hn.debug(`avatar "${l.id}" can't be animated (non-humanoid rig, no baked clips) \u2014 falling back to "${r.id}"`),Xu(u),vs(r,{...e,fallbackEntry:null});throw Xu(u),f}else throw Xu(u),f}return{model:u,controller:d,gltf:h,entry:l}}function Xu(i){i.traverse(e=>{if(!e.isMesh)return;e.geometry?.dispose?.();let t=Array.isArray(e.material)?e.material:[e.material];for(let n of t)if(n){for(let s of Object.values(n))s&&s.isTexture&&s.dispose();n.dispose?.()}})}function Gm(i,e,t,{waveMs:n}){let s=new us(i),r=y=>e.find(w=>w.name.toLowerCase()===String(y).toLowerCase()),a=y=>{for(let w of y){let A=r(w);if(A)return A}return null},o=y=>Array.isArray(t?.[y])?t[y]:[],c=a([...o("idle"),"Idle","idle"])||e[0]||null,l={idle:c,walk:a([...o("walk"),"Walking","Walk","walk"])||c,run:a([...o("run"),"Running","Run","run","Walking","walk"])||c,jump:a([...o("jump"),"Jump","jump","WalkJump"])||null,wave:a([...o("wave"),"Wave","wave"])||null},h={};for(let[y,w]of Object.entries(lM)){let A=a([...o(y),...w]);A&&(h[y]=A)}let u={};for(let[y,w]of Object.entries(l)){if(!w)continue;let A=s.clipAction(w);A.enabled=!0,u[y]=A}let d={};for(let[y,w]of Object.entries(h)){let A=s.clipAction(w);A.enabled=!0,d[y]=A}let f="idle",g="idle",_=null,m=!1;function p(y,{once:w=!1,dur:A=.3}={}){y&&(y.reset(),y.setLoop(w?zi:ps,w?1:1/0),y.clampWhenFinished=w,y.fadeIn(A).play(),_&&_!==y&&_.fadeOut(A),_=y)}function x(y,w){p(u[y]||u.idle,w)}return s.addEventListener("finished",()=>{m&&(m=!1,x(f,{dur:.25}))}),x("idle",{dur:0}),{setState(y){if(y!==g){if(g=y,y==="jump"){u.jump&&(m=!0,x("jump",{once:!0,dur:.12}));return}f=y,m||x(f,{dur:.22})}},emotes(){return Object.keys(d)},playEmote(y){let w=d[y];if(!w)return!1;m=!0,p(w,{once:!0,dur:.2});let A=w.getClip().duration*1e3||n;return clearTimeout(this._emoteGuard),this._emoteGuard=setTimeout(()=>{m&&(m=!1,x(f,{dur:.25}))},Math.min(A,Wm)+250),!0},playWave(){m||this.playEmote("wave")},setSpeed(y){s.timeScale=y>0?y:1},update(y){s.update(y)},dispose(){clearTimeout(this._emoteGuard),s.stopAllAction(),s.uncacheRoot(i)}}}async function uM(i,e,{manifestUrl:t,waveMs:n,emotes:s}){let r=new Sa;if(r.attach(i),!r.supportsCanonicalClips()){r.dispose();let f=new Error("walk: rig is not a retargetable humanoid (no skinned skeleton) \u2014 cannot drive shared clips");throw f.code=Xm,f}let a={},o={},c=new Map;try{let f=await fetch(t,{cache:"force-cache"}).then(m=>{if(!m.ok)throw new Error(`HTTP ${m.status} fetching animation manifest`);return m.json()}).then(m=>zm(m,t)),g=new Set(f.map(m=>m.name));for(let m of f)c.set(m.name,(Number(m.duration)||0)*1e3);for(let[m,p]of Object.entries({...zn,...e}))a[m]=g.has(p)?p:null;if(a.idle=a.idle||(g.has("idle")?"idle":null),!a.idle)throw new Error("animation manifest missing an idle clip");for(let m of Object.keys(a))a[m]||(a[m]=a.idle);o=qm(g,{...Aa,...s||{}});let _=new Set([...Object.values(a),...Object.values(o)]);r.setAnimationDefs(f.filter(m=>_.has(m.name))),await r.loadAll()}catch(f){throw r.dispose(),f}let l="idle",h=null,u=(f,g)=>Promise.resolve(r.crossfadeTo(f,g)).catch(()=>{}),d=f=>a[f]||a.idle;return u(a.idle,0),{setState(f){f!==l&&(l=f,h||u(d(f),f==="jump"?.12:.3))},emotes(){return Object.keys(o)},playEmote(f){let g=o[f];if(!g||g===a.idle)return!1;clearTimeout(h),u(g,.25);let _=c.get(g)||n;return h=setTimeout(()=>{h=null,u(d(l),.3)},Math.min(_,Wm)+150),!0},playWave(){if(h||this.playEmote("wave"))return;let f=a.wave;!f||f===a.idle||(u(f,.25),h=setTimeout(()=>{h=null,u(d(l),.3)},n))},setSpeed(f){r.mixer&&(r.mixer.timeScale=f>0?f:1)},update(f){r.update(f)},dispose(){clearTimeout(h),r.dispose()}}}var cM,Wm,lM,Xm,qu,tl=ct(()=>{"use strict";lt();Tu();Cp();Vu();Vm();Dc();el();cM=1500,Wm=8e3,lM={dance:["Dance"],punch:["Punch"],backflip:["Backflip","BackFlip","Back Flip","back_flip"],wave:["Wave"]};Xm="WALK_RIG_UNSUPPORTED",qu=null});function dM(){if(jm||typeof document>"u")return;jm=!0;let i=document.createElement("style");i.id="walk-picker-style",i.textContent=`
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
`,document.head.appendChild(i)}function nl(i){dM();let{avatars:e=[],onSelect:t,anchor:n={right:16,bottom:16},assetBase:s="",docsUrl:r}=i,a=i.currentId||null,o="",c=document.createElement("div");c.className="walk-picker",c.setAttribute("role","dialog"),c.setAttribute("aria-label","Choose your walking avatar"),c.style.right=`${n.right}px`,c.style.bottom=`${n.bottom}px`,c.innerHTML=`
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
	`;let l=c.querySelector(".walk-picker-list"),h=c.querySelector(".walk-picker-search input"),u=c.querySelector(".walk-picker-close");function d(A){let S=document.createElement("button");S.type="button",S.className="walk-picker-tile"+(A.id===a?" is-active":""),S.setAttribute("role","option"),S.setAttribute("aria-selected",String(A.id===a)),S.dataset.id=A.id,S.title=A.blurb||A.name,A.accent&&S.style.setProperty("--wp-accent",A.accent);let R=A.thumb?` style="background-image:url('${s}${A.thumb}')"`:"";S.innerHTML=`<span class="walk-picker-orb"${R}>${A.thumb?"":A.emoji||"\u{1F9CD}"}</span>`;let b=document.createElement("span");return b.className="walk-picker-name",b.textContent=A.name,S.appendChild(b),S.addEventListener("click",()=>g(A)),S}function f(){let A=o.trim().toLowerCase(),S=e.filter(b=>A?b.name.toLowerCase().includes(A)||b.category.toLowerCase().includes(A)||(b.tags||[]).some(T=>T.includes(A)):!0);if(l.innerHTML="",!S.length){let b=document.createElement("div");b.className="walk-picker-empty",b.textContent=`No avatars match \u201C${o}\u201D.`,l.appendChild(b);return}let R=[];for(let b of S)R.includes(b.category)||R.push(b.category);for(let b of R){let T=document.createElement("div");T.className="walk-picker-cat",T.textContent=b,l.appendChild(T);let P=document.createElement("div");P.className="walk-picker-grid";for(let C of S.filter(N=>N.category===b))P.appendChild(d(C));l.appendChild(P)}}function g(A){a=A.id,f(),t?.(A),y()}let _=!1,m=A=>{!c.contains(A.target)&&!A.target.closest?.("[data-walk-picker-toggle]")&&y()},p=A=>{if(A.key==="Escape"){A.stopPropagation(),y();return}let S=[...l.querySelectorAll(".walk-picker-tile")],R=S.indexOf(document.activeElement);if(["ArrowRight","ArrowDown","ArrowLeft","ArrowUp"].includes(A.key)&&S.length){A.preventDefault();let b=matchMedia("(max-width:520px)").matches?4:3,T=R;A.key==="ArrowRight"?T=R+1:A.key==="ArrowLeft"?T=R-1:A.key==="ArrowDown"?T=R+b:A.key==="ArrowUp"&&(T=R-b),T=Math.max(0,Math.min(S.length-1,T)),S[T]?.focus()}};h.addEventListener("input",()=>{o=h.value,f()}),u.addEventListener("click",y),c.addEventListener("keydown",p);function x(){_||(_=!0,f(),document.body.appendChild(c),requestAnimationFrame(()=>{c.classList.add("is-in"),mp()||h.focus()}),setTimeout(()=>document.addEventListener("pointerdown",m,!0),0))}function y(){_&&(_=!1,c.classList.remove("is-in"),document.removeEventListener("pointerdown",m,!0),setTimeout(()=>{!_&&c.parentNode&&c.parentNode.removeChild(c)},200))}function w(){y(),c.removeEventListener("keydown",p)}return{el:c,show:x,close:y,toggle(){_?y():x()},isOpen:()=>_,setCurrent(A){a=A,_&&f()},destroy:w}}var jm,il=ct(()=>{"use strict";Oc();jm=!1});function Wi(i={}){let e=i.storagePrefix||"walk";return{avatars:i.avatars||$c,defaultAvatarId:i.defaultAvatarId||Gu,assetBase:i.assetBase||"",apiBase:i.apiBase||"",manifestUrl:i.manifestUrl||"/animations/manifest.json",excludedRoutes:i.excludedRoutes||Ym,enablePicker:i.enablePicker!==!1,lookAt:i.lookAt!==!1,greeting:typeof i.greeting=="function"?i.greeting:null,docsUrl:i.docsUrl||null,keys:{enabled:`${e}:companion:enabled`,state:`${e}:companion:state`,avatar:`${e}:companion:avatar`,greet:`${e}:companion:greet`,invited:`${e}:companion:invited`,resume:`${e}:playground:resume`,mode:`${e}:playground:mode`}}}function bi(i,e){if(!i)return Zc(e.defaultAvatarId)||e.avatars[0];let t=e.avatars.find(n=>n.id===i)||Zc(i);return t||Wu(i)}var Ym,sl=ct(()=>{"use strict";el();Ym=["/walk","/walk-embed","/embed","/play","/club","/city","/xr","/ar","/pose","/mocap-studio","/avatar-studio","/studio"]});function TM(){if(tg||typeof document>"u")return;tg=!0;let i=document.createElement("style");i.id="walk-cp-style",i.textContent=`
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
`,document.head.appendChild(i)}function sg(i,{checkpoints:e,onReach:t,onComplete:n,startCheckpoint:s}={}){i._checkpoints=Array.isArray(e)&&e.length?e:null,i._onReach=typeof t=="function"?t:null,i._onComplete=typeof n=="function"?n:null,i._activeCp=i._checkpoints?Math.max(0,Math.min(s||0,i._checkpoints.length)):0,i._narrating=!1,i._cpMarkers=[]}function rg(i){i._checkpoints&&(TM(),i._cpMarkers=i._checkpoints.map((e,t)=>{let n=document.createElement("div");return n.className="walk-cp is-locked",n.innerHTML=`<span class="walk-cp__num">${t+1}</span><span class="walk-cp__ring"></span>`,n.setAttribute("aria-hidden","true"),document.body.appendChild(n),n}),ag(i),Ju(i))}function ag(i){i._cpMarkers.forEach((e,t)=>{let n=t<i._activeCp;e.classList.toggle("is-done",n),e.classList.toggle("is-active",t===i._activeCp&&!n),e.classList.toggle("is-locked",t>i._activeCp)})}function Ju(i){if(i._cpMarkers?.length)for(let e=0;e<i._cpMarkers.length;e++){let t=i._checkpoints[e]?.el,n=i._cpMarkers[e];if(!t||!t.isConnected){n.style.opacity="0";continue}let s=t.getBoundingClientRect(),r=s.left+s.width/2,a=Math.min(window.innerHeight-36,Math.max(36,s.bottom-26));n.style.left=r+"px",n.style.top=a+"px",n.style.opacity=a<-60||a>window.innerHeight+60?"0":""}}function og(i){let e=i._activeCp,t=i._checkpoints[e]?.el;if(!t||!t.isConnected)return;let n=i.char.x-(window.scrollX||0),s=i.char.y-(window.scrollY||0),r=t.getBoundingClientRect(),a=26;if(n>=r.left-a&&n<=r.right+a&&s>=r.top-a&&s<=r.bottom+a){i._narrating=!0,i.char.vx=0,i.char.vy=0;let o=()=>RM(i);i._onReach?i._onReach(e,o):o()}}function RM(i){i._activeCp++,ag(i),i._narrating=!1,i._activeCp>=i._checkpoints.length&&i._onComplete?.()}function cg(i){i._cpMarkers?.length&&(i._cpMarkers.forEach(e=>e.remove()),i._cpMarkers=[])}function lg(){try{return localStorage.getItem(Rt.keys.mode)==="platformer"?"platformer":"stroll"}catch{return"stroll"}}function CM(i){try{localStorage.setItem(Rt.keys.mode,i==="platformer"?"platformer":"stroll")}catch{}}function si(){return Math.max(document.documentElement.clientWidth,window.innerWidth||0)}function ys(){let i=document.scrollingElement||document.documentElement;return Math.max(i.scrollHeight,window.innerHeight||0)}function hg(){return Math.max(0,ys()-window.innerHeight)}function LM(i,e){let t=document.elementFromPoint(i,e);if(!t)return null;let n=t.closest?.("a[href]");if(!n||n.target&&n.target!=="_self")return null;let s=n.getAttribute("href")||"";if(!s||s.startsWith("#")||s.startsWith("javascript:"))return null;try{let r=new URL(s,location.href);return r.origin!==location.origin?null:{href:r.href,el:n}}catch{return null}}function ug(i){let e=i==="platformer"?"Platformer":"Stroll";return`<button type="button" class="walk-pg-mode" aria-label="Switch movement mode (currently ${e})" title="Switch mode (M)"><span class="walk-pg-mode-ic" aria-hidden="true">${i==="platformer"?"\u{1F3AE}":"\u{1F6B6}"}</span><span class="walk-pg-mode-tx">${e}</span></button>`}function dg(){return'<button type="button" class="walk-pg-pick" data-walk-picker-toggle aria-label="Choose your avatar" title="Choose avatar (C)"><span class="walk-pg-pick-ic" aria-hidden="true">\u{1F9D1}</span><span class="walk-pg-pick-tx">Avatar</span></button>'}function $u(i){if(!i.host)return;i.host.querySelector(".walk-pg-emotes")?.remove();let e=i.controller?.emotes?.()||[],t=fg.filter(s=>e.includes(s.name));if(!t.length)return;let n=document.createElement("div");n.className="walk-pg-emotes",n.setAttribute("role","toolbar"),n.setAttribute("aria-label","Emotes: make the character perform"),n.innerHTML=t.map(s=>`<button type="button" class="walk-pg-emote" data-emote="${s.name}" aria-label="${s.label}" title="${s.label} (${s.key})"><span aria-hidden="true">${s.icon}</span></button>`).join(""),n.addEventListener("click",s=>{let r=s.target.closest(".walk-pg-emote");r&&pg(i,r.getAttribute("data-emote"))}),i.host.appendChild(n)}function pg(i,e){if(i._diving||i._narrating||!i.controller?.playEmote?.(e))return;let t=i.host?.querySelector(`.walk-pg-emote[data-emote="${e}"]`);t&&(t.classList.remove("is-playing"),t.offsetWidth,t.classList.add("is-playing"))}function mg(i,e){let t=fg.find(n=>n.key===e);return!t||!i.host?.querySelector(`.walk-pg-emote[data-emote="${t.name}"]`)?!1:(pg(i,t.name),!0)}function ng(i){i.traverse(e=>{if(!e.isMesh)return;e.geometry?.dispose?.(),(Array.isArray(e.material)?e.material:[e.material]).forEach(n=>{if(n){for(let s of Object.values(n))s&&s.isTexture&&s.dispose();n.dispose?.()}})})}function ol(i){Rt.enablePicker!==!1&&(i._picker||(i._picker=nl({avatars:Rt.avatars,currentId:i._avatarId||Rt.defaultAvatarId,assetBase:Rt.assetBase,docsUrl:Rt.docsUrl,onSelect:e=>PM(i,e)})),i._picker.toggle())}async function PM(i,e){let t=typeof e=="string"?bi(e,Rt):e;if(!(!t||!i.mounted||!i.rig)&&t.id!==i._avatarId){i._avatarId=t.id;try{localStorage.setItem(Rt.keys.avatar,t.id)}catch{}i._picker?.setCurrent(t.id),i._say?.("Switching\u2026",4e3);try{let n=await Zu(t.id,i._charPx);if(!i.mounted||!i.rig){ng(n.model),n.controller?.dispose?.();return}i.model&&(i.rig.remove(i.model),ng(i.model)),i.controller?.dispose?.(),i.rig.add(n.model),i.model=n.model,i.controller=n.controller,i.modelHalfW=n.halfW,typeof i._shadowR=="number"&&(i._shadowR=Math.max(22,n.halfW*1.15)),$u(i),i._say?.(`Say hi to ${t.name}!`)}catch(n){Hn.warn("avatar swap failed:",n?.message||n),i._say?.("Couldn\u2019t load that one \u2014 try another.")}}}function gg(i){i._picker?.destroy(),i._picker=null}async function Zu(i,e){let t=bi(i,Rt),n=bi(Rt.defaultAvatarId,Rt),{model:s,controller:r}=await vs(t,{assetBase:Rt.assetBase,apiBase:Rt.apiBase,manifestUrl:Rt.manifestUrl,fallbackEntry:n}),o=new Tt().setFromObject(s).getSize(new L),c=e/Math.max(.001,o.y);s.scale.setScalar(c);let l=new Tt().setFromObject(s),h=l.getCenter(new L);return s.position.x-=h.x,s.position.z-=h.z,s.position.y-=l.min.y,{model:s,controller:r,halfW:o.x*c/2}}function _g(){let i=typeof navigator<"u"&&navigator.getGamepads?navigator.getGamepads():null;if(!i)return null;let e=null;for(let r of i)if(r&&r.connected){e=r;break}if(!e)return null;let t=e.axes[0]||0,n=e.axes[1]||0,s=r=>!!e.buttons[r]?.pressed;return{left:t<-al||s(14),right:t>al||s(15),up:n<-al||s(12),down:n>al||s(13),faceA:s(0),faceB:s(1)}}function bg(i,e,t){for(let n in t)t[n]?(i[n]=!0,e[n]=!0):e[n]&&(i[n]=!1,e[n]=!1)}function xg(i){try{i.controller?.dispose()}catch{}i.controller=null,i.scene&&i.scene.traverse(e=>{e.isMesh&&(e.geometry?.dispose?.(),(Array.isArray(e.material)?e.material:[e.material]).forEach(n=>{if(n){for(let s of Object.values(n))s&&s.isTexture&&s.dispose();n.dispose?.()}}))}),i.scene=null,i.renderer&&(i.renderer.dispose(),i.renderer.forceContextLoss?.(),i.renderer=null,Jh()),i.host?.parentNode&&i.host.parentNode.removeChild(i.host),i.host=null}function vg(){if(ig)return;ig=!0;let i=document.createElement("style");i.id="walk-pg-style",i.textContent=`
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
`,document.head.appendChild(i)}function yg(i){return i==="platformer"?Ku:Yu}function cl(i={}){if(i.config&&(Rt=i.config),qe)return qe;let e=i.mode||lg();return qe=new(yg(e)),qe.mount({...i,mode:e}),qe}function xi(){qe&&(qe.unmount(),qe=null);try{window.dispatchEvent(new CustomEvent("walk-playground:exit"))}catch{}}function qi(i=null){if(!qe||!qe.mounted)return null;let e=qe.mode,t=i||(e==="platformer"?"stroll":"platformer");if(t===e)return qe;CM(t);let n=qe.currentScreenPos(),s=qe._avatarId||null,r=qe._checkpoints?{checkpoints:qe._checkpoints,onReach:qe._onReach,onComplete:qe._onComplete,startCheckpoint:qe._activeCp}:null;qe.unmount(),qe=new(yg(t)),qe.mount({avatarId:s,startScreen:n,switched:!0,mode:t,...r});try{window.dispatchEvent(new CustomEvent("walk-playground:mode",{detail:{mode:t}}))}catch{}return qe}function Ea(){return qe?.mode||lg()}function wg(){if(!qe||!qe.mounted)return null;let i=qe.char,e={mode:qe.mode,x:Math.round(i.x),y:Math.round(i.y),vx:Math.round(i.vx),vy:Math.round(i.vy),diving:qe._diving};return qe._checkpoints&&(e.quest={checkpoint:qe._activeCp,total:qe._checkpoints.length,narrating:qe._narrating}),qe.mode==="platformer"?{...e,grounded:i.grounded,facing:i.facing,platforms:qe.platforms.length,onLink:!!qe.platform?.href}:{...e,speed:Math.round(Math.hypot(i.vx,i.vy)),onLink:!!qe._armHref}}var Rt,Km,Jm,$m,mM,gM,Yt,Zm,_M,bM,ju,xM,Qm,eg,vM,yM,wM,MM,SM,rl,AM,EM,tg,fg,al,Yu,Ku,ig,qe,Mg=ct(()=>{"use strict";lt();$h();Dc();Oc();tl();il();sl();Rt=Wi(),Km=150,Jm=3600,$m=360,mM=250,gM=3200,Yt=30,Zm=.5,_M=1100,bM=90,ju=138,xM=2600,Qm=2400,eg=330,vM=250,yM=1e3,wM=2600,MM=1400,SM=2400,rl=26,AM=14,EM=["a[href]","button","h1","h2","h3","h4","p","li","img","figure",".card","[data-platform]"].join(","),tg=!1;fg=[{name:"dance",icon:"\u{1F57A}",label:"Dance",key:"1"},{name:"punch",icon:"\u{1F44A}",label:"Punch",key:"2"},{name:"backflip",icon:"\u{1F938}",label:"Backflip",key:"3"},{name:"wave",icon:"\u{1F44B}",label:"Wave",key:"4"}];al=.45;Yu=class{constructor(){this.mode="stroll",this.mounted=!1,this._reduced=Nc(),this._raf=0,this._diveTimer=0,this._hintTimer=0,this._tick=this._tick.bind(this),this._onKeyDown=this._onKeyDown.bind(this),this._onKeyUp=this._onKeyUp.bind(this),this._onResize=this._onResize.bind(this),this._onVisibility=this._onVisibility.bind(this),this.char={x:0,y:0,vx:0,vy:0,facing:0},this._yaw=0,this.input={up:!1,down:!1,left:!1,right:!1,dive:!1},this._padHeld={},this._armEl=null,this._armHref=null,this._lastProbe=0,this._diving=!1,this._spawnGuardUntil=0,this._v0=new L,this._v1=new L,this._picker=null,this.model=null,this._charPx=Km}async mount({avatarId:e=null,startScreen:t=null,dropIn:n=!1,switched:s=!1,checkpoints:r=null,onReach:a=null,onComplete:o=null,startCheckpoint:c=0}={}){if(!this.mounted){if(!Uc()){Hn.warn("playground: WebGL unavailable");return}this.mounted=!0,this._avatarId=e,sg(this,{checkpoints:r,onReach:a,onComplete:o,startCheckpoint:c}),this._buildDom();try{await this._buildScene()}catch(l){Hn.warn("playground failed to load avatar:",l?.message||l),this._teardown();return}if(!this.mounted){this._teardown();return}$u(this),this._placeStart(t,n),rg(this),this._spawnGuardUntil=performance.now()+_M,this._bindEvents(),s?this._sayModeIntro():this._hintFor(n),this.clock=new Ui,this._raf=requestAnimationFrame(this._tick)}}setNarrating(e){this._narrating=!!e}unmount(){this.mounted&&(this.mounted=!1,cancelAnimationFrame(this._raf),this._raf=0,clearTimeout(this._diveTimer),clearTimeout(this._hintTimer),window.removeEventListener("keydown",this._onKeyDown,!0),window.removeEventListener("keyup",this._onKeyUp,!0),window.removeEventListener("resize",this._onResize),document.removeEventListener("visibilitychange",this._onVisibility),this._clearArm(),gg(this),cg(this),this._teardown())}_onVisibility(){document.hidden?(cancelAnimationFrame(this._raf),this._raf=0):this.mounted&&!this._raf&&(this._raf=requestAnimationFrame(this._tick))}currentScreenPos(){return{x:this.char.x-(window.scrollX||0),y:this.char.y-(window.scrollY||0)}}_buildDom(){vg();let e=document.createElement("div");e.className="walk-pg walk-pg--stroll",this._checkpoints&&e.classList.add("is-quest"),e.setAttribute("role","application"),e.setAttribute("aria-label","Page playground \u2014 walk the character with the arrow keys"),e.innerHTML=`
			<canvas class="walk-pg-canvas"></canvas>
			<div class="walk-pg-hint" aria-live="polite"></div>
			${Rt.enablePicker===!1?"":dg()}
			${ug(this.mode)}
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
		`,document.body.appendChild(e),this.host=e,this.canvas=e.querySelector(".walk-pg-canvas"),this.hintEl=e.querySelector(".walk-pg-hint"),this.flashEl=e.querySelector(".walk-pg-flash"),e.querySelector(".walk-pg-exit").addEventListener("click",()=>xi()),e.querySelector(".walk-pg-mode").addEventListener("click",()=>qi()),e.querySelector(".walk-pg-pick")?.addEventListener("click",t=>{t.stopPropagation(),ol(this)}),e.querySelectorAll(".walk-pg-btn").forEach(t=>{let n=t.getAttribute("data-act"),s=a=>{a.preventDefault(),this._setAct(n,!0)},r=a=>{a.preventDefault(),this._setAct(n,!1)};t.addEventListener("pointerdown",s),t.addEventListener("pointerup",r),t.addEventListener("pointerleave",r),t.addEventListener("pointercancel",r)}),requestAnimationFrame(()=>e.classList.add("is-in"))}_setAct(e,t){e in this.input&&(this.input[e]=t)}async _buildScene(){let e=new _s({canvas:this.canvas,alpha:!0,antialias:!0});e.setPixelRatio(Math.min(window.devicePixelRatio,2)),this.renderer=e,kc(),this._resizeRenderer();let t=new Ii;this.scene=t,t.add(new Ni(16777215,.9));let n=new Fi(12375807,1712688,.75);n.position.set(0,300,0),t.add(n);let s=new $n(16777215,1.7);s.position.set(80,320,260),t.add(s),this._setupCamera();let r=new Nt;t.add(r),this.rig=r;let a=new It(new jr(1,28),new fn({color:329484,transparent:!0,opacity:.32,side:rn,depthWrite:!1}));a.renderOrder=-1,t.add(a),this.shadow=a;let{model:o,controller:c,halfW:l}=await Zu(this._avatarId,Km);this.modelHalfW=l,this._shadowR=Math.max(22,l*1.15),r.add(o),this.model=o,this.controller=c}_setupCamera(){let e=window.innerWidth,t=window.innerHeight,n=new Nn(-e/2,e/2,t/2,-t/2,-4e3,8e3),s=3e3;n.position.set(0,Math.sin(Zm)*s,Math.cos(Zm)*s),n.up.set(0,1,0),n.lookAt(0,0,0),n.updateProjectionMatrix(),n.updateMatrixWorld(!0),this.camera=n}_pagePointAtScreen(e,t,n){let s=window.innerWidth,r=window.innerHeight,a=e/s*2-1,o=-(t/r*2-1),c=this._v0.set(a,o,-1).unproject(this.camera),l=this._v1.set(a,o,1).unproject(this.camera),h=l.z-c.z,u=Math.abs(h)<1e-6?0:-c.z/h;return n.set(c.x+(l.x-c.x)*u,c.y+(l.y-c.y)*u,0)}_placeStart(e,t){let n=window.scrollX||0,s=window.scrollY||0,r=si();e?(this.char.x=Vt(e.x+n,Yt,r-Yt),this.char.y=Vt(e.y+s,Yt,ys()-Yt)):(this.char.x=Vt(r*.5,Yt,r-Yt),this.char.y=Vt(s+window.innerHeight*(t?.32:.4),Yt,ys()-Yt)),this.char.vx=0,this.char.vy=0,this._dropIn=t}_bindEvents(){window.addEventListener("keydown",this._onKeyDown,!0),window.addEventListener("keyup",this._onKeyUp,!0),window.addEventListener("resize",this._onResize),document.addEventListener("visibilitychange",this._onVisibility)}_onKeyDown(e){let t=e.key;if(this._picker?.isOpen())return;if(t==="Escape"){xi();return}if(t==="m"||t==="M"){e.preventDefault(),qi();return}if(t==="c"||t==="C"){e.preventDefault(),ol(this);return}if(mg(this,t)){e.preventDefault();return}let n=!0;t==="ArrowLeft"||t==="a"||t==="A"?this.input.left=!0:t==="ArrowRight"||t==="d"||t==="D"?this.input.right=!0:t==="ArrowUp"||t==="w"||t==="W"?this.input.up=!0:t==="ArrowDown"||t==="s"||t==="S"?this.input.down=!0:t===" "||t==="Spacebar"||t==="Enter"||t==="e"||t==="E"?this.input.dive=!0:n=!1,n&&e.preventDefault()}_onKeyUp(e){let t=e.key;t==="ArrowLeft"||t==="a"||t==="A"?this.input.left=!1:t==="ArrowRight"||t==="d"||t==="D"?this.input.right=!1:t==="ArrowUp"||t==="w"||t==="W"?this.input.up=!1:t==="ArrowDown"||t==="s"||t==="S"?this.input.down=!1:(t===" "||t==="Spacebar"||t==="Enter"||t==="e"||t==="E")&&(this.input.dive=!1)}_onResize(){this._resizeRenderer(),this._setupCamera(),this.char.x=Vt(this.char.x,Yt,si()-Yt),this.char.y=Vt(this.char.y,Yt,ys()-Yt)}_resizeRenderer(){this.renderer.setSize(window.innerWidth,window.innerHeight,!1)}_hintFor(e){let n=matchMedia("(pointer: coarse)").matches?"Use the d-pad to walk":"Arrow keys / WASD to walk anywhere";if(this._checkpoints){this._say(`${n} \u2014 reach the glowing checkpoint.`,5200);return}this._say(e?`You're in! ${n}. Step on a link to dive deeper.`:`${n}. Step on a link to dive in.`,5200)}_sayModeIntro(){this._say("Stroll mode \u2014 free roam, no falling. M to switch back.",3800)}_say(e,t=3200){!this.hintEl||!e||(this.hintEl.textContent=e,this.hintEl.classList.add("is-in"),clearTimeout(this._hintTimer),this._hintTimer=setTimeout(()=>this.hintEl?.classList.remove("is-in"),t))}_armLink(e,t){this._armEl!==e&&(this._clearArm(),this._armEl=e,this._armHref=t,e.classList.add("walk-pg-portal"),this._say("Press Space (or \u2B07 / gamepad) to dive in",2400))}_clearArm(){this._armEl&&this._armEl.classList.remove("walk-pg-portal"),this._armEl=null,this._armHref=null}_dive(e){if(this._diving||!e)return;this._diving=!0,this.controller?.setState("jump"),this._armEl&&this._armEl.classList.add("is-open"),Fc(Rt.keys.resume,"1"),this.flashEl?.classList.add("is-on");let t=()=>{location.href=e};if(this._reduced){t();return}this.char.vx=0,this.char.vy=0,this._diveTimer=setTimeout(t,560)}_tick(){if(!this.mounted)return;this.clock.update();let e=Math.min(this.clock.getDelta(),.033);this._diving||this._step(e),this._follow(),this._render(e),this._checkpoints&&Ju(this),this._raf=requestAnimationFrame(this._tick)}_pollGamepad(){let e=_g();bg(this.input,this._padHeld,{up:!!e?.up,down:!!e?.down,left:!!e?.left,right:!!e?.right,dive:!!(e?.faceA||e?.faceB)})}_step(e){this._pollGamepad();let t=this.char,n=(this.input.right?1:0)-(this.input.left?1:0),s=(this.input.down?1:0)-(this.input.up?1:0);if(this._narrating&&(n=0,s=0),n!==0&&s!==0){let c=1/Math.SQRT2;n*=c,s*=c}if(n!==0||s!==0){t.vx+=n*Jm*e,t.vy+=s*Jm*e;let c=Math.hypot(t.vx,t.vy);if(c>$m){let l=$m/c;t.vx*=l,t.vy*=l}}else{let c=gM*e,l=Math.hypot(t.vx,t.vy);if(l<=c)t.vx=0,t.vy=0;else{let h=(l-c)/l;t.vx*=h,t.vy*=h}}t.x=Vt(t.x+t.vx*e,Yt,si()-Yt),t.y=Vt(t.y+t.vy*e,Yt,ys()-Yt);let r=Math.hypot(t.vx,t.vy);r>12&&(this.char.facing=Math.atan2(t.vx,t.vy));let a=performance.now();if(!this._checkpoints&&a-this._lastProbe>bM){this._lastProbe=a;let c=t.x-(window.scrollX||0),l=t.y-(window.scrollY||0),h=LM(c,l);h?this._armLink(h.el,h.href):this._armEl&&this._clearArm()}if(!this._checkpoints&&this._armHref&&this.input.dive&&a>this._spawnGuardUntil){this._dive(this._armHref);return}let o="idle";r>mM?o="run":r>12&&(o="walk"),this.controller?.setState(o),this._checkpoints&&!this._narrating&&og(this)}_follow(){let e=window.innerHeight,t=window.scrollY||0,n=this.char.y-t,s=e*.3,r=e*.7,a=t;n<s?a=this.char.y-s:n>r&&(a=this.char.y-r),a=Vt(a,0,hg()),Math.abs(a-t)>.5&&window.scrollTo(0,a)}_render(e){let t=this.char,n=t.x-(window.scrollX||0),s=t.y-(window.scrollY||0);if(this._pagePointAtScreen(n,s,this._v0),this.rig.position.copy(this._v0),this.shadow&&(this.shadow.position.set(this._v0.x,this._v0.y,this._v0.z+.5),this.shadow.scale.set(this._shadowR,this._shadowR*.5,1)),this._diving){this.rig.rotation.y+=e*10;let r=Math.max(.04,this.rig.scale.x-e*1.6);this.rig.scale.setScalar(r),this.shadow&&(this.shadow.material.opacity=Math.max(0,this.shadow.material.opacity-e*.8))}else{let r=this.char.facing-this._yaw;for(;r>Math.PI;)r-=Math.PI*2;for(;r<-Math.PI;)r+=Math.PI*2;this._yaw+=r*Math.min(1,e*11),this.rig.rotation.y=this._yaw}this.controller?.update(e),this.renderer.render(this.scene,this.camera)}_teardown(){xg(this)}},Ku=class{constructor(){this.mode="platformer",this.mounted=!1,this._reduced=Nc(),this._raf=0,this._diveTimer=0,this._hintTimer=0,this._tick=this._tick.bind(this),this._onKeyDown=this._onKeyDown.bind(this),this._onKeyUp=this._onKeyUp.bind(this),this._onResize=this._onResize.bind(this),this._onVisibility=this._onVisibility.bind(this),this._scheduleRescan=this._scheduleRescan.bind(this),this.char={x:0,y:0,vx:0,vy:0,grounded:!1,facing:1},this.platform=null,this.platforms=[],this._lastScan=0,this._scrollY=0,this.input={left:!1,right:!1,jump:!1,down:!1},this._padHeld={},this._jumpEdge=!1,this._armEl=null,this._armHref=null,this._diving=!1,this._picker=null,this.model=null,this._charPx=ju}async mount({avatarId:e=null,startScreen:t=null,dropIn:n=!1,switched:s=!1,checkpoints:r=null,onReach:a=null,onComplete:o=null,startCheckpoint:c=0}={}){if(!this.mounted){if(!Uc()){Hn.warn("playground: WebGL unavailable");return}this.mounted=!0,this._avatarId=e,sg(this,{checkpoints:r,onReach:a,onComplete:o,startCheckpoint:c}),this._buildDom();try{await this._buildScene()}catch(l){Hn.warn("playground failed to load avatar:",l?.message||l),this._teardown();return}if(!this.mounted){this._teardown();return}$u(this),this._scrollY=window.scrollY||0,this._scan(!0),this._placeStart(t,n),rg(this),this._spawnGuardUntil=performance.now()+1500,this._bindEvents(),s?this._sayModeIntro():this._hintFor(n),this.clock=new Ui,this._raf=requestAnimationFrame(this._tick)}}setNarrating(e){this._narrating=!!e}unmount(){this.mounted&&(this.mounted=!1,cancelAnimationFrame(this._raf),this._raf=0,clearTimeout(this._diveTimer),clearTimeout(this._hintTimer),window.removeEventListener("keydown",this._onKeyDown,!0),window.removeEventListener("keyup",this._onKeyUp,!0),window.removeEventListener("resize",this._onResize),window.removeEventListener("scroll",this._scheduleRescan,!0),document.removeEventListener("visibilitychange",this._onVisibility),this._clearArm(),gg(this),cg(this),this._teardown())}_onVisibility(){document.hidden?(cancelAnimationFrame(this._raf),this._raf=0):this.mounted&&!this._raf&&(this._raf=requestAnimationFrame(this._tick))}currentScreenPos(){return{x:this.char.x-(window.scrollX||0),y:this.char.y-(window.scrollY||0)}}_buildDom(){vg();let e=document.createElement("div");e.className="walk-pg walk-pg--plat",this._checkpoints&&e.classList.add("is-quest"),e.setAttribute("role","application"),e.setAttribute("aria-label","Page playground \u2014 walk and jump the character with arrow keys"),e.innerHTML=`
			<canvas class="walk-pg-canvas"></canvas>
			<div class="walk-pg-hint" aria-live="polite"></div>
			${Rt.enablePicker===!1?"":dg()}
			${ug(this.mode)}
			<button type="button" class="walk-pg-exit" aria-label="Exit playground" title="Exit (Esc)">Exit \u2715</button>
			<div class="walk-pg-pad" aria-hidden="true">
				<button type="button" class="walk-pg-btn" data-act="left" aria-label="Walk left">\u25C0</button>
				<button type="button" class="walk-pg-btn" data-act="right" aria-label="Walk right">\u25B6</button>
				<button type="button" class="walk-pg-btn walk-pg-jump" data-act="jump" aria-label="Jump">\u2912</button>
				<button type="button" class="walk-pg-btn" data-act="down" aria-label="Dive into link">\u2913</button>
			</div>
			<div class="walk-pg-flash" aria-hidden="true"></div>
		`,document.body.appendChild(e),this.host=e,this.canvas=e.querySelector(".walk-pg-canvas"),this.hintEl=e.querySelector(".walk-pg-hint"),this.flashEl=e.querySelector(".walk-pg-flash"),e.querySelector(".walk-pg-exit").addEventListener("click",()=>xi()),e.querySelector(".walk-pg-mode").addEventListener("click",()=>qi()),e.querySelector(".walk-pg-pick")?.addEventListener("click",t=>{t.stopPropagation(),ol(this)}),e.querySelectorAll(".walk-pg-btn").forEach(t=>{let n=t.getAttribute("data-act"),s=a=>{a.preventDefault(),this._setAct(n,!0)},r=a=>{a.preventDefault(),this._setAct(n,!1)};t.addEventListener("pointerdown",s),t.addEventListener("pointerup",r),t.addEventListener("pointerleave",r),t.addEventListener("pointercancel",r)}),requestAnimationFrame(()=>e.classList.add("is-in"))}_setAct(e,t){e==="left"?this.input.left=t:e==="right"?this.input.right=t:e==="jump"?(this.input.jump=t,t||(this._jumpEdge=!1)):e==="down"&&(this.input.down=t)}async _buildScene(){let e=new _s({canvas:this.canvas,alpha:!0,antialias:!0});e.setPixelRatio(Math.min(window.devicePixelRatio,2)),this.renderer=e,kc(),this._resizeRenderer();let t=new Ii;this.scene=t,t.add(new Ni(16777215,.9));let n=new Fi(12375807,1712688,.75);n.position.set(0,200,0),t.add(n);let s=new $n(16777215,1.7);s.position.set(120,260,220),t.add(s),this.camera=new Nn(0,window.innerWidth,0,-window.innerHeight,-1e3,2e3),this.camera.position.z=600;let r=new Nt;t.add(r),this.rig=r;let{model:a,controller:o,halfW:c}=await Zu(this._avatarId,ju);this.modelHalfW=c,r.add(a),this.model=a,this.controller=o}_placeStart(e,t){let n=window.scrollY||0;t?(this.char.x=Vt(si()*.5,40,si()-40),this.char.y=n-ju,this.char.vy=60,this.char.grounded=!1):e?(this.char.x=Vt(e.x+(window.scrollX||0),40,si()-40),this.char.y=e.y+n,this.char.vy=40,this.char.grounded=!1):(this.char.x=Vt(si()*.5,40,si()-40),this.char.y=n+window.innerHeight*.3,this.char.vy=0)}_scan(e=!1){let t=performance.now();if(!e&&t-this._lastScan<180)return;this._lastScan=t;let n=window.scrollX||0,s=window.scrollY||0,r=s-1100,a=s+window.innerHeight+1100,o=[],c=new Set,l=document.querySelectorAll(EM);for(let u of l){if(o.length>=360)break;if(this.host.contains(u))continue;let d=u.getBoundingClientRect();if(d.width<38||d.height<14||d.height>520)continue;let f=d.top+s,g=d.bottom+s;if(g<r||f>a)continue;let _=u.ownerDocument.defaultView.getComputedStyle(u);if(_.visibility==="hidden"||_.display==="none"||+_.opacity==0)continue;let m=d.left+n,p=d.right+n,x=`${Math.round(m)},${Math.round(f)},${Math.round(p)}`;if(c.has(x))continue;c.add(x);let y=u.closest("a[href]"),w=null;if(y){let A=y.getAttribute("href")||"";if(A&&!A.startsWith("#")&&(!y.target||y.target==="_self"))try{let S=new URL(A,location.href);S.origin===location.origin&&(w=S.href)}catch{}}o.push({left:m,right:p,top:f,bottom:g,href:w,el:u})}let h=si();o.push({left:-40,right:h+40,top:ys()-3,bottom:ys(),href:null,el:null}),this.platforms=o,this.platform&&!o.includes(this.platform)&&o.push(this.platform)}_scheduleRescan(){this._scrollY=window.scrollY||0,this._scan()}_bindEvents(){window.addEventListener("keydown",this._onKeyDown,!0),window.addEventListener("keyup",this._onKeyUp,!0),window.addEventListener("resize",this._onResize),window.addEventListener("scroll",this._scheduleRescan,!0),document.addEventListener("visibilitychange",this._onVisibility)}_onKeyDown(e){let t=e.key;if(this._picker?.isOpen())return;if(t==="Escape"){xi();return}if(t==="m"||t==="M"){e.preventDefault(),qi();return}if(t==="c"||t==="C"){e.preventDefault(),ol(this);return}if(mg(this,t)){e.preventDefault();return}let n=!0;t==="ArrowLeft"||t==="a"||t==="A"?this.input.left=!0:t==="ArrowRight"||t==="d"||t==="D"?this.input.right=!0:t===" "||t==="ArrowUp"||t==="w"||t==="W"||t==="Spacebar"?this.input.jump=!0:t==="ArrowDown"||t==="s"||t==="S"?this.input.down=!0:n=!1,n&&e.preventDefault()}_onKeyUp(e){let t=e.key;t==="ArrowLeft"||t==="a"||t==="A"?this.input.left=!1:t==="ArrowRight"||t==="d"||t==="D"?this.input.right=!1:t===" "||t==="ArrowUp"||t==="w"||t==="W"||t==="Spacebar"?(this.input.jump=!1,this._jumpEdge=!1):(t==="ArrowDown"||t==="s"||t==="S")&&(this.input.down=!1)}_onResize(){this._resizeRenderer(),this.camera&&(this.camera.right=window.innerWidth,this.camera.bottom=-window.innerHeight,this.camera.updateProjectionMatrix()),this._scan(!0)}_resizeRenderer(){this.renderer.setSize(window.innerWidth,window.innerHeight,!1)}_hintFor(e){let n=matchMedia("(pointer: coarse)").matches?"Use the buttons":"Arrow keys / WASD to move, Space to jump";if(this._checkpoints){this._say(`${n} \u2014 reach the glowing checkpoint.`,5200);return}this._say(e?`You fell in! ${n}. Land on a link to dive deeper.`:`${n}. Land on a link to dive in.`,5200)}_sayModeIntro(){let t=matchMedia("(pointer: coarse)").matches?"tap \u2912 to jump":"Space to jump";this._say(`Platformer mode \u2014 gravity on, ${t}. M to switch back.`,3800)}_say(e,t=3200){!this.hintEl||!e||(this.hintEl.textContent=e,this.hintEl.classList.add("is-in"),clearTimeout(this._hintTimer),this._hintTimer=setTimeout(()=>this.hintEl?.classList.remove("is-in"),t))}_armLink(e){this._armEl!==e.el&&(this._clearArm(),this._armEl=e.el,this._armHref=e.href,e.el.classList.add("walk-pg-portal"),this._say("Press \u2193 (or \u2913 / gamepad) to dive in",2200))}_clearArm(){this._armEl&&this._armEl.classList.remove("walk-pg-portal"),this._armEl=null,this._armHref=null}_dive(e){if(this._diving||!e)return;this._diving=!0,this.controller?.setState("jump"),this._armEl&&this._armEl.classList.add("is-open"),Fc(Rt.keys.resume,"1"),this.flashEl?.classList.add("is-on");let t=()=>{location.href=e};if(this._reduced){t();return}this.char.vx=0,this.char.vy=Qm,this.char.grounded=!1,this._diveTimer=setTimeout(t,620)}_tick(){if(!this.mounted)return;this.clock.update();let e=Math.min(this.clock.getDelta(),.033);this._diving||this._step(e),this._follow(e),this._render(e),this._checkpoints&&Ju(this),this._raf=requestAnimationFrame(this._tick)}_pollGamepad(){let e=_g();bg(this.input,this._padHeld,{left:!!e?.left,right:!!e?.right,jump:!!e?.faceA,down:!!(e?.down||e?.faceB)})}_step(e){this._pollGamepad();let t=this.char,n=this._narrating,s=n?0:(this.input.right?1:0)-(this.input.left?1:0),r=t.grounded?wM:MM;if(s!==0)t.vx+=s*r*e,t.vx=Vt(t.vx,-eg,eg),t.facing=s;else if(t.grounded){let l=SM*e;Math.abs(t.vx)<=l?t.vx=0:t.vx-=Math.sign(t.vx)*l}if(this.input.jump||(this._jumpEdge=!1),this.input.jump&&t.grounded&&!this._jumpEdge&&!n&&(t.vy=-yM,t.grounded=!1,this.platform=null,this._jumpEdge=!0,this._clearArm()),this.input.down&&t.grounded&&!n)if(this.platform?.href&&!this._checkpoints){if(performance.now()>this._spawnGuardUntil){this._dive(this.platform.href);return}}else{t.y+=4,t.grounded=!1;let l=this.platform;this.platform=null,this._dropIgnore=l}t.vy=Math.min(t.vy+xM*e,Qm);let a=t.y;if(t.x=Vt(t.x+t.vx*e,this.modelHalfW,si()-this.modelHalfW),t.y=t.y+t.vy*e,t.vy>=0){let l=null;for(let h of this.platforms)h!==this._dropIgnore&&(t.x<h.left-rl||t.x>h.right+rl||a<=h.top+AM&&t.y>=h.top&&(!l||h.top<l.top)&&(l=h));if(l)t.y=l.top,t.vy=0,t.grounded=!0,this.platform=l,this._dropIgnore=null;else if(t.grounded&&this.platform){let h=this.platform;t.x<h.left-rl||t.x>h.right+rl?(t.grounded=!1,this.platform=null):t.y=h.top}else t.grounded=!1}let o=performance.now()>this._spawnGuardUntil;!this._checkpoints&&o&&t.grounded&&this.platform?.href&&Math.abs(t.vx)<30&&s===0?this._armLink(this.platform):this._armEl&&(!t.grounded||this.platform?.el!==this._armEl||s!==0)&&this._clearArm();let c="idle";t.grounded?Math.abs(t.vx)>vM?c="run":Math.abs(t.vx)>6&&(c="walk"):c="jump",this.controller?.setState(c),this._checkpoints&&!this._narrating&&t.grounded&&og(this)}_follow(e){let t=Vt(this.char.y-window.innerHeight*.55,0,hg()),n=window.scrollY||0,s=this._reduced?t:n+(t-n)*Math.min(1,e*6);Math.abs(s-n)>.5&&window.scrollTo(0,s),this._scrollY=window.scrollY||0,this._scan()}_render(e){let t=this.char,n=window.scrollX||0,s=window.scrollY||0,r=t.x-n,a=t.y-s;if(this.rig.position.set(r,-a,0),this._diving){this.rig.rotation.y+=e*9;let o=Math.max(.05,this.rig.scale.x-e*1.4);this.rig.scale.setScalar(o)}else{let o=t.facing>=0?.6:-.6;this.rig.rotation.y+=(o-this.rig.rotation.y)*Math.min(1,e*10)}this.controller?.update(e),this.renderer.render(this.scene,this.camera)}_teardown(){xg(this)}};ig=!1;qe=null;typeof window<"u"&&(window.__walkPlayground={launch:cl,exit:xi,switchMode:qi,mode:Ea,state:wg})});var vS={};Ca(vS,{DEFAULT_COPY:()=>Ia,DEFAULT_VOICES:()=>bl,ExploreMode:()=>Mr,TourDirector:()=>wr,VERSION:()=>_S,buildCurriculum:()=>Ug,buildPlaylist:()=>Ts,createFeatureTour:()=>id,createTourState:()=>Es,loadCurriculum:()=>As,normalizePath:()=>Qt,resolveTourConfig:()=>Rs,sectionTitle:()=>Pa,stopIndexForPath:()=>La,trackMeta:()=>fd});var _l=new Map;async function As(i){let e=i?.curriculum??"/tour/curriculum.json";if(e&&typeof e=="object")return dd(e),e;if(_l.has(e))return _l.get(e);let t=await fetch(e,{cache:"force-cache"});if(!t.ok)throw new Error(`tour curriculum ${t.status}`);let n=await t.json();return dd(n),_l.set(e,n),n}function dd(i){if(!i||!Array.isArray(i.stops)||!i.stops.length)throw new Error("tour curriculum empty")}function Qt(i=location.pathname){let e=i.replace(/\/+$/,"");return e===""?"/":e}var Zg={active:!1,index:0,track:"full",paused:!1,muted:!1,voice:"nova",speed:1},Qg={index:0,track:"full",voice:"nova",speed:1,completed:!1};function Es(i){let e=i.keys.state,t=i.keys.resume,n={...Zg,voice:i.defaultVoice},s={...Qg,voice:i.defaultVoice};function r(){try{let u=localStorage.getItem(t);return u?{...s,...JSON.parse(u)}:{...s}}catch{return{...s}}}function a(u){let d={...r(),...u};try{localStorage.setItem(t,JSON.stringify(d))}catch{}return d}function o(){try{let u=sessionStorage.getItem(e);return u?{...n,...JSON.parse(u)}:{...n}}catch{return{...n}}}function c(u){let d={...o(),...u};try{sessionStorage.setItem(e,JSON.stringify(d))}catch{}return d.active&&a({index:d.index,track:d.track,voice:d.voice,speed:d.speed}),d}function l(){try{sessionStorage.removeItem(e)}catch{}}function h(){a({completed:!0,index:0})}return{readState:o,writeState:c,clearState:l,readResume:r,writeResume:a,markCompleted:h}}function Ts(i,e="full"){let t=i.stops.map((s,r)=>r);if(e!=="quick")return t;let n=t.filter(s=>i.stops[s].highlight);return n.length?n:t}function fd(i,e="full"){return(i.tracks||[]).find(t=>t.id===e)||null}function La(i,e=location.pathname){let t=Qt(e);return i.stops.findIndex(n=>Qt(n.path)===t)}function Pa(i,e){return(i.sections||[]).find(t=>t.id===e)?.title||""}var bl=[{id:"nova",name:"Nova"},{id:"alloy",name:"Alloy"},{id:"echo",name:"Echo"},{id:"fable",name:"Fable"},{id:"onyx",name:"Onyx"},{id:"sage",name:"Sage"},{id:"shimmer",name:"Shimmer"}],Ia={outro:"And that's the tour. Thanks for walking through it with me \u2014 explore on your own whenever you're ready.",offRoute:"We stepped off the tour \u2014 press play and I\u2019ll take you back to where we were.",completion:{title:"Tour complete \u{1F389}",body:"That's the whole tour. Where to next?",primary:null,restartLabel:"Take it again",closeLabel:"Explore on my own"}};function pd(i){return i!=null&&typeof i=="object"}function e0(i={}){let e={...Ia,...i};return e.completion={...Ia.completion,...i.completion||{}},e}function Rs(i={}){let e=i.storagePrefix||"tws:tour",t=i.companion===!1?null:{global:pd(i.companion)&&i.companion.global||"__walkCompanion",changeEvent:pd(i.companion)&&i.companion.changeEvent||"walk-companion:change"};return{curriculum:i.curriculum??"/tour/curriculum.json",ttsEndpoint:i.ttsEndpoint===void 0?null:i.ttsEndpoint,defaultVoice:i.defaultVoice||"nova",voices:Array.isArray(i.voices)&&i.voices.length?i.voices:bl,mode:i.mode==="explore"||i.mode==="platformer"?i.mode:"guided",guideAvatarId:i.guideAvatarId||"realistic-female",assetBase:i.assetBase||"",apiBase:i.apiBase||"",manifestUrl:i.manifestUrl||"/animations/manifest.json",avatarStorageKey:i.avatarStorageKey||"walk:companion:avatar",navigate:typeof i.navigate=="function"?i.navigate:n=>{location.assign(n)},deepLinkParam:i.deepLinkParam||"tour",companion:t,copy:e0(i.copy),keys:{state:`${e}:state`,resume:`${e}:resume`}}}lt();$h();Dc();Oc();tl();Vu();il();sl();Mg();el();il();tl();sl();var on=168,xn=240,Ht=16,IM=2147483300,ed=2.7,td=4.2,kM=1.5,DM=3.4,FM=ed/kM,RR=td/DM,Qu=200,NM=-14,UM=.32,OM=.18,ll=class{constructor(e={}){this.config=Wi({assetBase:e.assetBase||"",apiBase:e.apiBase||"",manifestUrl:e.manifestUrl||"/animations/manifest.json",defaultAvatarId:e.guideAvatarId||"realistic-female"}),this.avatarStorageKey=e.avatarStorageKey||this.config.keys.avatar,this.host=null,this.renderer=null,this.scene=null,this.camera=null,this.rig=null,this.model=null,this.controller=null,this.clock=null,this._raf=0,this._pxPerMeter=0,this._walkPx=Qu,this._runPx=Qu*(td/ed),this._yaw=0,this._targetYaw=0,this._walking=!1,this._walkRaf=0,this._reduced=matchMedia("(prefers-reduced-motion: reduce)").matches,this._pos={x:0,y:0},this._groundY=0,this._y=0,this._vy=0,this._tick=this._tick.bind(this)}async mount(){VM(),this._buildDom();try{await this._buildScene(),this.clock=new Ui,this._raf=requestAnimationFrame(this._tick)}catch(t){console.warn("[tour] guide avatar failed to load \u2014 continuing without a rendered body:",t?.message||t),this._headless=!0,this.canvas?.remove()}let e={x:window.innerWidth-on-Ht,y:window.innerHeight-xn-Ht};this._setPos(e)}_buildDom(){let e=document.createElement("div");e.className="tws-tour-guide",e.setAttribute("role","complementary"),e.setAttribute("aria-label","Tour guide"),e.innerHTML=`
			<div class="tws-tour-guide__bubble" hidden></div>
			<canvas class="tws-tour-guide__canvas" width="${on}" height="${xn}"></canvas>
		`,document.body.appendChild(e),this.host=e,this.canvas=e.querySelector(".tws-tour-guide__canvas"),this.bubble=e.querySelector(".tws-tour-guide__bubble"),requestAnimationFrame(()=>e.classList.add("is-in"))}async _buildScene(){let e=new _s({canvas:this.canvas,alpha:!0,antialias:!0});e.setPixelRatio(Math.min(window.devicePixelRatio,1.5)),e.setSize(on,xn,!1),this.renderer=e;let t=new Ii;this.scene=t,t.add(new Ni(16777215,.9));let n=new Fi(12375807,2107440,.7);n.position.set(0,4,0),t.add(n);let s=new $n(16777215,1.6);s.position.set(2,5,4),t.add(s),this.camera=new At(40,on/xn,.05,100),this.rig=new Nt,t.add(this.rig);let r=HM(this.avatarStorageKey)||this.config.defaultAvatarId,a=bi(r,this.config),o=bi(this.config.defaultAvatarId,this.config),{model:c,controller:l}=await vs(a,{assetBase:this.config.assetBase,apiBase:this.config.apiBase,manifestUrl:this.config.manifestUrl,fallbackEntry:o});this.model=c,this.controller=l,this._frame(c,this.rig,this.camera)}_frame(e,t,n){let s=new Tt().setFromObject(e),r=s.getSize(new L),a=s.getCenter(new L);e.position.x-=a.x,e.position.z-=a.z,e.position.y-=s.min.y,t.add(e);let o=Math.max(.6,r.y);n.position.set(0,o*.62,o*2.2),n.lookAt(0,o*.52,0);let l=2*n.position.distanceTo(new L(0,o*.52,0))*Math.tan(n.fov*Math.PI/180/2),h=this.size().h||xn;this._pxPerMeter=l>0?h/l:0,this._pxPerMeter>0&&(this._walkPx=ed*this._pxPerMeter,this._runPx=td*this._pxPerMeter),this._y=this._reduced?this._groundY:this._groundY+UM,this._vy=0,t.position.y=this._y}walkTo(e){let t={x:br(e.x,Ht,window.innerWidth-on-Ht),y:br(e.y,Ht,window.innerHeight-xn-Ht)};cancelAnimationFrame(this._walkRaf),this._walkRaf=0;let n=t.x-this._pos.x,s=t.y-this._pos.y,r=Math.hypot(n,s);if(r<4||this._reduced)return this._setPos(t),this.settle(),Promise.resolve();let a=n/r,o=s/r,c={x:this._pos.x,y:this._pos.y},l=0,h=performance.now();return new Promise(u=>{let d=f=>{let g=Math.min((f-h)/1e3,.05);if(h=f,l=Math.min(r,l+(this._walkPx||Qu)*g),this.place({x:c.x+a*l,y:c.y+o*l}),l>=r){this._walkRaf=0,this.settle(),u();return}this._walkRaf=requestAnimationFrame(d)};this._walkRaf=requestAnimationFrame(d)})}async approach(e){let t=this._spotBeside(e);await this.walkTo(t),this._faceRect(e)}async park(){await this.walkTo({x:window.innerWidth-on-Ht,y:window.innerHeight-xn-Ht}),this._targetYaw=0}point(){this.controller?.playWave()}setInteractive(e){this.host&&(this.host.style.pointerEvents=e?"auto":"none",this.host.classList.toggle("is-roam",!!e))}size(){let e=this.host?.getBoundingClientRect();return{w:e?.width||on,h:e?.height||xn}}place(e){let t=this.size(),n=br(e.x,Ht,window.innerWidth-t.w-Ht),s=br(e.y,Ht,window.innerHeight-t.h-Ht),r=n-this._pos.x,a=s-this._pos.y;Math.hypot(r,a)>1&&(this._targetYaw=Math.atan2(r,a)),this.controller?.setState("walk"),this.controller?.setSpeed?.(FM),this._walking=!0,clearTimeout(this._settleTimer),this._settleTimer=setTimeout(()=>this.settle(),180),this._setPos({x:n,y:s})}settle(){clearTimeout(this._settleTimer),this._walking=!1,this._targetYaw=0,this.controller?.setState("idle"),this.controller?.setSpeed?.(1)}_spotBeside(e){let n=e.left+e.width+22,s=e.left-on-22,r;n+on<=window.innerWidth-Ht?r=n:s>=Ht?r=s:r=br(e.cx-on/2,Ht,window.innerWidth-on-Ht);let a=br(e.cy-xn*.58,Ht,window.innerHeight-xn-Ht);return{x:r,y:a}}_faceRect(e){let t=this._pos.x+on/2,n=this._pos.y+xn/2;this._targetYaw=Math.atan2(e.cx-t,e.cy-n)}headScreen(){return{x:this._pos.x+on/2,y:this._pos.y+xn*.18}}say(e){this.bubble&&(this.bubble.textContent=e,this.bubble.hidden=!1,requestAnimationFrame(()=>this.bubble.classList.add("is-in")))}hideBubble(){this.bubble&&(this.bubble.classList.remove("is-in"),setTimeout(()=>{this.bubble&&(this.bubble.hidden=!0)},280))}_setPos(e){this._pos=e,this.host&&(this.host.style.left=e.x+"px",this.host.style.top=e.y+"px")}_tick(){if(!this.host)return;this.clock.update();let e=Math.min(this.clock.getDelta(),.05);this._yaw+=BM(this._targetYaw-this._yaw)*OM,this.rig&&(this.rig.rotation.y=this._yaw,this._vy+=NM*e,this._y+=this._vy*e,this._y<=this._groundY&&(this._y=this._groundY,this._vy<0&&(this._vy=0)),this.rig.position.y=this._y),this.controller?.update(e),this.renderer.render(this.scene,this.camera),this._raf=requestAnimationFrame(this._tick)}dispose(){cancelAnimationFrame(this._raf),cancelAnimationFrame(this._walkRaf),clearTimeout(this._settleTimer),this._raf=0,this._walkRaf=0;try{this.controller?.dispose()}catch{}this.scene&&this.scene.traverse(e=>{e.isMesh&&zM(e)}),this.renderer&&(this.renderer.dispose(),this.renderer.forceContextLoss?.()),this.host?.remove(),this.host=null}};function br(i,e,t){return Math.min(t,Math.max(e,i))}function BM(i){return Math.atan2(Math.sin(i),Math.cos(i))}function HM(i){try{return localStorage.getItem(i)}catch{return null}}function zM(i){i.geometry?.dispose?.(),(Array.isArray(i.material)?i.material:[i.material]).forEach(t=>{if(t){for(let n of Object.values(t))n&&n.isTexture&&n.dispose();t.dispose?.()}})}var Sg=!1;function VM(){if(Sg)return;Sg=!0;let i=document.createElement("style");i.id="tws-tour-guide-style",i.textContent=`
.tws-tour-guide{position:fixed;left:0;top:0;width:${on}px;height:${xn}px;z-index:${IM};pointer-events:none;opacity:0;transform:translateY(10px);transition:opacity .4s ease,transform .4s ease;-webkit-user-select:none;user-select:none}
.tws-tour-guide.is-in{opacity:1;transform:translateY(0)}
.tws-tour-guide__canvas{position:absolute;inset:0;width:100%;height:100%;filter:drop-shadow(0 16px 20px rgba(0,0,0,.34))}
.tws-tour-guide__bubble{position:absolute;left:50%;bottom:calc(100% - 30px);transform:translateX(-50%) translateY(8px);width:max-content;max-width:320px;background:rgba(18,20,28,.96);color:#f2f4f8;font:500 13px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;padding:10px 13px;border-radius:14px;border:1px solid rgba(122,162,255,.28);box-shadow:0 12px 30px rgba(0,0,0,.4);opacity:0;transition:opacity .3s ease,transform .3s ease;text-align:left}
.tws-tour-guide__bubble.is-in{opacity:1;transform:translateX(-50%) translateY(0)}
.tws-tour-guide__bubble::after{content:'';position:absolute;left:50%;top:100%;transform:translateX(-50%);border:7px solid transparent;border-top-color:rgba(18,20,28,.96)}
@media (max-width:560px){.tws-tour-guide{width:128px;height:182px}.tws-tour-guide__bubble{max-width:230px;font-size:12px}}
@media (prefers-reduced-motion:reduce){.tws-tour-guide,.tws-tour-guide__bubble{transition:opacity .2s ease}}
`,document.head.appendChild(i)}var Ag=!1;function GM(){if(Ag)return;Ag=!0;let i=document.createElement("style");i.id="tws-tour-spotlight-style",i.textContent=`
.tws-tour-spot{position:fixed;z-index:2147483100;border-radius:12px;pointer-events:none;
	box-shadow:0 0 0 9999px rgba(8,10,16,.62),0 0 0 2px rgba(122,162,255,.9),0 0 28px 6px rgba(122,162,255,.55) inset;
	transition:left .45s cubic-bezier(.4,0,.2,1),top .45s cubic-bezier(.4,0,.2,1),width .45s cubic-bezier(.4,0,.2,1),height .45s cubic-bezier(.4,0,.2,1),opacity .3s ease;
	opacity:0}
.tws-tour-spot.is-in{opacity:1}
.tws-tour-spot::after{content:'';position:absolute;inset:-2px;border-radius:14px;border:2px solid rgba(122,162,255,.55);animation:tws-tour-pulse 1.8s ease-in-out infinite}
@keyframes tws-tour-pulse{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.012);opacity:.25}}
@media (prefers-reduced-motion:reduce){.tws-tour-spot{transition:opacity .2s ease}.tws-tour-spot::after{animation:none}}
`,document.head.appendChild(i)}var xr=class{constructor(){GM(),this.el=document.createElement("div"),this.el.className="tws-tour-spot",this.el.setAttribute("aria-hidden","true"),document.body.appendChild(this.el),this.target=null,this._raf=0,this._rect=null,this._track=this._track.bind(this)}async highlight(e){if(this.target=e||null,!e){this.el.classList.remove("is-in"),this._rect=null;return}await WM(e),this._track(),this.el.classList.add("is-in"),this._raf||(this._raf=requestAnimationFrame(this._track))}_track(){this._raf=0;let e=this.target;if(!e||!e.isConnected){this.el.classList.remove("is-in"),this._rect=null;return}let t=e.getBoundingClientRect();if(t.width<1&&t.height<1)this.el.classList.remove("is-in");else{let s=Math.max(0,t.left-8),r=Math.max(0,t.top-8),a=Math.min(window.innerWidth,t.right+8)-s,o=Math.min(window.innerHeight,t.bottom+8)-r;this.el.style.left=s+"px",this.el.style.top=r+"px",this.el.style.width=a+"px",this.el.style.height=o+"px",this.el.classList.add("is-in"),this._rect={left:s,top:r,width:a,height:o,cx:s+a/2,cy:r+o/2}}this._raf=requestAnimationFrame(this._track)}getRect(){return this._rect}clear(){this.target=null,this._rect=null,this.el.classList.remove("is-in")}dispose(){cancelAnimationFrame(this._raf),this.el?.remove()}};function WM(i){return new Promise(e=>{let t=i.getBoundingClientRect();if(t.top>=64&&t.bottom<=window.innerHeight-64){e();return}let s=matchMedia("(prefers-reduced-motion: reduce)").matches;i.scrollIntoView({behavior:s?"auto":"smooth",block:"center",inline:"nearest"}),setTimeout(e,s?0:480)})}var vr=class{constructor(e={}){this.endpoint=e.ttsEndpoint||null,this.audio=null,this._token=0,this._sleepTimer=0,this._sleepResolve=null,this._finishCurrent=null}estimateMs(e,t=1){let n=String(e||"").trim().split(/\s+/).filter(Boolean).length;return Math.max(1600,n/150*6e4+600)/Eg(t)}async speak(e,{muted:t=!1,voice:n="nova",speed:s=1}={}){this.cancel();let r=++this._token,a=Eg(s),o=String(e||"").trim();if(!o)return;if(!this.endpoint||t){await this._sleep(this.estimateMs(o,a),r);return}let c=null;try{let l=await fetch(this.endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:o.slice(0,4096),voice:n,speed:a,format:"mp3"})});if(r!==this._token)return;if(!l.ok)throw new Error(`tts ${l.status}`);let h=await l.blob();if(r!==this._token)return;c=URL.createObjectURL(h);let u=new Audio(c);u.playbackRate=a,this.audio=u,await new Promise(d=>{let f=!1,g=()=>{f||(f=!0,d())};this._finishCurrent=g,u.addEventListener("ended",g),u.addEventListener("error",g),u.play().catch(g)})}catch{if(r!==this._token)return;await this._sleep(this.estimateMs(o),r)}finally{c&&URL.revokeObjectURL(c),r===this._token&&(this.audio=null,this._finishCurrent=null)}}_sleep(e,t){return new Promise(n=>{this._sleepResolve=n,this._sleepTimer=setTimeout(()=>{t===this._token&&n()},e)})}cancel(){this._token++,clearTimeout(this._sleepTimer),this._sleepTimer=0,this._sleepResolve&&(this._sleepResolve(),this._sleepResolve=null);try{this.audio?.pause()}catch{}this._finishCurrent&&this._finishCurrent(),this._finishCurrent=null,this.audio=null}dispose(){this.cancel()}};function Eg(i){let e=Number(i);return Number.isFinite(e)?Math.min(2,Math.max(.5,e)):1}var hl=class{constructor(e){this.handlers=e,XM(),this._build()}_build(){let e=document.createElement("div");e.className="tws-tour-bar",e.setAttribute("role","group"),e.setAttribute("aria-label","Guided tour controls"),e.innerHTML=`
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
		`,document.body.appendChild(e),this.bar=e,this.menuBtn=e.querySelector('[data-act="menu"]'),this.playBtn=e.querySelector('[data-act="toggle"]'),this.muteBtn=e.querySelector('[data-act="mute"]'),this.speedBtn=e.querySelector('[data-act="speed"]'),this.roamBtn=e.querySelector('[data-act="roam"]'),this.chapterEl=e.querySelector(".tws-tour-chapter"),this.countEl=e.querySelector(".tws-tour-count"),this.track=e.querySelector(".tws-tour-track"),this.fill=e.querySelector(".tws-tour-track__fill"),e.addEventListener("click",t=>{let n=t.target.closest("[data-act]")?.dataset.act;n&&(n==="menu"?this.handlers.onMenu?.():n==="prev"?this.handlers.onPrev?.():n==="next"?this.handlers.onNext?.():n==="toggle"?this.handlers.onToggle?.():n==="speed"?this.handlers.onSpeed?.():n==="roam"?this.handlers.onRoam?.():n==="mute"?this.handlers.onMute?.():n==="exit"&&this.handlers.onExit?.())}),this.track.addEventListener("click",t=>this._seekFromEvent(t)),this.track.addEventListener("keydown",t=>{t.key==="ArrowRight"?this.handlers.onNext?.():t.key==="ArrowLeft"&&this.handlers.onPrev?.()}),requestAnimationFrame(()=>e.classList.add("is-in"))}_seekFromEvent(e){let t=this.track.getBoundingClientRect(),n=qM((e.clientX-t.left)/t.width,0,1),s=this._total||1,r=Math.round(n*(s-1));this.handlers.onSeek?.(r)}update({chapter:e,index:t,total:n}){this._total=n,this.chapterEl.textContent=e||"",this.countEl.textContent=`${t+1} / ${n}`;let s=n>1?t/(n-1):1;this.fill.style.width=(s*100).toFixed(1)+"%",this.track.setAttribute("aria-valuemax",String(n)),this.track.setAttribute("aria-valuenow",String(t+1)),this.track.setAttribute("aria-valuetext",`${e}, feature ${t+1} of ${n}`)}setPaused(e){this.playBtn.textContent=e?"\u25B6":"\u23F8",this.playBtn.setAttribute("aria-label",e?"Resume tour":"Pause tour"),this.bar.classList.toggle("is-paused",e)}setMuted(e){this.muteBtn.textContent=e?"\u{1F507}":"\u{1F50A}",this.muteBtn.setAttribute("aria-label",e?"Unmute narration":"Mute narration")}setSpeed(e){let t=(Number(e)||1).toFixed(2).replace(/\.?0+$/,"");this.speedBtn.textContent=t+"\xD7",this.speedBtn.setAttribute("aria-label",`Playback speed ${t} times \u2014 tap to change`)}setMenuOpen(e){this.menuBtn.setAttribute("aria-expanded",e?"true":"false"),this.menuBtn.classList.toggle("is-active",e)}setRoam(e){this.roamBtn.setAttribute("aria-pressed",e?"true":"false"),this.roamBtn.classList.toggle("is-active",e),this.roamBtn.setAttribute("title",e?"Rejoin the tour":"Free roam"),this.bar.classList.toggle("is-roaming",e)}dispose(){this.bar?.remove(),this.bar=null}};function qM(i,e,t){return Math.min(t,Math.max(e,i))}var Tg=!1;function XM(){if(Tg)return;Tg=!0;let i=document.createElement("style");i.id="tws-tour-bar-style",i.textContent=`
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
`,document.head.appendChild(i)}var jM=[{id:"nova",name:"Nova"},{id:"alloy",name:"Alloy"},{id:"fable",name:"Fable"}],YM=[.75,1,1.25,1.5],ul=class{constructor(e,t,n){this.curriculum=e,this.handlers=t,this.voices=Array.isArray(n)&&n.length?n:jM,this.open=!1,this.activeAbs=0,this._query="",this._onKey=this._onKey.bind(this),$M(),this._build()}_build(){let e=document.createElement("div");e.className="tws-tour-menu",e.innerHTML=`
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
			</aside>`,document.body.appendChild(e),this.root=e,this.panel=e.querySelector(".tws-tour-menu__panel"),this.listEl=e.querySelector(".tws-tour-menu__list"),this.trackSeg=e.querySelector('[data-group="track"]'),this.speedSeg=e.querySelector('[data-group="speed"]'),this.voiceSel=e.querySelector('[data-act="voice"]'),this.searchInput=e.querySelector(".tws-tour-menu__input"),this._buildSegments(),this._buildVoices(),this._buildList(),e.addEventListener("click",t=>{t.target.closest('[data-act="close"]')&&this.close()}),this.trackSeg.addEventListener("click",t=>{let n=t.target.closest("[data-val]")?.dataset.val;n&&this.handlers.onTrack?.(n)}),this.speedSeg.addEventListener("click",t=>{let n=t.target.closest("[data-val]")?.dataset.val;n&&this.handlers.onSpeed?.(Number(n))}),this.voiceSel.addEventListener("change",()=>this.handlers.onVoice?.(this.voiceSel.value)),this.searchInput.addEventListener("input",()=>{this._query=this.searchInput.value.trim().toLowerCase(),this._buildList()}),this.listEl.addEventListener("click",t=>{let n=t.target.closest("[data-abs]")?.dataset.abs;n!=null&&(this.handlers.onJump?.(Number(n)),this.close())})}_buildSegments(){let e=this.curriculum.tracks?.length?this.curriculum.tracks:[{id:"full",title:"Full"}];this.trackSeg.innerHTML=e.map(t=>`<button class="tws-tour-seg__btn" data-val="${t.id}" role="radio" aria-checked="false" title="${ws(t.description||"")}">${ws((t.title||"").replace(/ tour| highlights/i,""))}${t.estimatedMinutes?` \xB7 ~${t.estimatedMinutes}m`:""}</button>`).join(""),this.speedSeg.innerHTML=YM.map(t=>`<button class="tws-tour-seg__btn" data-val="${t}" role="radio" aria-checked="false">${String(t).replace(/\.?0+$/,"")}\xD7</button>`).join("")}_buildVoices(){this.voiceSel.innerHTML=this.voices.map(e=>`<option value="${ws(e.id)}">${ws(e.name)}</option>`).join("")}_buildList(){let{sections:e=[],stops:t}=this.curriculum,n=this._query,s=[],r=e.length?e:KM(t);for(let a of r){let o=t.map((c,l)=>({s:c,abs:l})).filter(({s:c})=>c.section===a.id).filter(({s:c})=>!n||c.title.toLowerCase().includes(n));if(o.length){s.push(`<div class="tws-tour-chap"><span class="tws-tour-chap__t">${ws(a.title)}</span><span class="tws-tour-chap__n">${o.length}</span></div>`);for(let{s:c,abs:l}of o)s.push(`<button class="tws-tour-stop${l===this.activeAbs?" is-current":""}" data-abs="${l}" aria-current="${l===this.activeAbs?"true":"false"}">
						<span class="tws-tour-stop__dot"${c.highlight?' data-hl="1"':""}></span>
						<span class="tws-tour-stop__title">${ws(c.title)}</span>
						${c.highlight?'<span class="tws-tour-stop__star" title="In the Quick highlights">\u2605</span>':""}
					</button>`)}}this.listEl.innerHTML=s.join("")||`<div class="tws-tour-menu__empty">No features match \u201C${ws(this._query)}\u201D.</div>`}setActive(e){this.activeAbs=e,this.listEl.querySelectorAll(".tws-tour-stop").forEach(t=>{let n=Number(t.dataset.abs)===e;t.classList.toggle("is-current",n),t.setAttribute("aria-current",n?"true":"false")}),this.open&&this._scrollToActive()}setTrack(e){this._mark(this.trackSeg,e)}setSpeed(e){this._mark(this.speedSeg,String(e))}setVoice(e){this.voiceSel.value=e}_mark(e,t){e.querySelectorAll(".tws-tour-seg__btn").forEach(n=>{let s=n.dataset.val===t;n.classList.toggle("is-on",s),n.setAttribute("aria-checked",s?"true":"false")})}toggle(){this.open?this.close():this.show()}show(){this.open||(this.open=!0,this.root.classList.add("is-open"),this._scrollToActive(),document.addEventListener("keydown",this._onKey,!0),requestAnimationFrame(()=>this.searchInput.focus()),this.handlers.onOpenChange?.(!0))}close(){this.open&&(this.open=!1,this.root.classList.remove("is-open"),document.removeEventListener("keydown",this._onKey,!0),this.handlers.onOpenChange?.(!1))}_scrollToActive(){this.listEl.querySelector(".tws-tour-stop.is-current")?.scrollIntoView({block:"center",behavior:"auto"})}_onKey(e){e.key==="Escape"&&(e.stopPropagation(),e.preventDefault(),this.close())}dispose(){document.removeEventListener("keydown",this._onKey,!0),this.root?.remove(),this.root=null}};function KM(i){let e=new Map;for(let t of i){let n=t.section||"tour";e.has(n)||e.set(n,{id:n,title:JM(n)})}return[...e.values()]}function JM(i){return String(i||"").replace(/[-_]+/g," ").replace(/\b\w/g,e=>e.toUpperCase())}function ws(i){return String(i??"").replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e])}var Rg=!1;function $M(){if(Rg)return;Rg=!0;let i=document.createElement("style");i.id="tws-tour-menu-style",i.textContent=`
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
`,document.head.appendChild(i)}var ZM='a,button,input,textarea,select,label,summary,[role="button"],[contenteditable],[contenteditable="true"],canvas,video,iframe,[data-walk-block]';function QM(i){return!!(i&&i.closest&&i.closest(ZM))}var dl=class{constructor(e){this.avatar=e,this.enabled=!1,this.dragging=!1,this._grab={x:0,y:0},this._ptr={x:0,y:0},this._scrollRaf=0,this._reduced=matchMedia("(prefers-reduced-motion: reduce)").matches,this._onDown=this._onDown.bind(this),this._onMove=this._onMove.bind(this),this._onUp=this._onUp.bind(this),nS()}enable(){this.enabled||(this.enabled=!0,this.avatar.setInteractive(!0),document.addEventListener("pointerdown",this._onDown,!0),this._hint=tS())}disable(){this.enabled&&(this.enabled=!1,this._endDrag(),document.removeEventListener("pointerdown",this._onDown,!0),this.avatar.setInteractive(!1),this.avatar.settle(),this._hint?.remove(),this._hint=null)}_onDown(e){if(!this.enabled||e.button!==0||e.altKey||e.metaKey||e.ctrlKey||e.shiftKey)return;let t=this.avatar.host;if(t&&t.contains(e.target)){let s=t.getBoundingClientRect();this._grab={x:e.clientX-s.left,y:e.clientY-s.top},this._ptr={x:e.clientX,y:e.clientY},this.dragging=!0,document.addEventListener("pointermove",this._onMove,!0),document.addEventListener("pointerup",this._onUp,!0),document.addEventListener("pointercancel",this._onUp,!0),this._startScrollLoop(),this._dismissHint(),e.preventDefault();return}if(QM(e.target))return;let n=this.avatar.size();this.avatar.walkTo({x:e.clientX-n.w/2,y:e.clientY-n.h/2}),this._reduced||eS(e.clientX,e.clientY),this._dismissHint()}_onMove(e){this.dragging&&(this._ptr={x:e.clientX,y:e.clientY},this.avatar.place({x:e.clientX-this._grab.x,y:e.clientY-this._grab.y}))}_onUp(){this._endDrag()}_endDrag(){cancelAnimationFrame(this._scrollRaf),this._scrollRaf=0,this.dragging&&(this.dragging=!1,document.removeEventListener("pointermove",this._onMove,!0),document.removeEventListener("pointerup",this._onUp,!0),document.removeEventListener("pointercancel",this._onUp,!0),this.avatar.settle())}_startScrollLoop(){if(this._reduced)return;let e=()=>{if(!this.dragging)return;let t=this._ptr.y,n=window.innerHeight,s=0;t<96?s=-22*(1-t/96):t>n-96&&(s=22*(1-(n-t)/96)),s&&(window.scrollBy(0,s),this.avatar.place({x:this._ptr.x-this._grab.x,y:this._ptr.y-this._grab.y})),this._scrollRaf=requestAnimationFrame(e)};this._scrollRaf=requestAnimationFrame(e)}_dismissHint(){if(!this._hint)return;this._hint.classList.remove("is-in");let e=this._hint;this._hint=null,setTimeout(()=>e.remove(),300)}};function eS(i,e){let t=document.createElement("div");t.className="tws-roam-ripple",t.style.left=i+"px",t.style.top=e+"px",document.body.appendChild(t),setTimeout(()=>t.remove(),600)}function tS(){let i=document.createElement("div");return i.className="tws-roam-hint",i.setAttribute("role","status"),i.innerHTML='<span class="tws-roam-hint__dot"></span>Free roam \u2014 click anywhere to walk me there, or drag me around. Press \u25B6 to rejoin the tour.',document.body.appendChild(i),requestAnimationFrame(()=>i.classList.add("is-in")),i}var Cg=!1;function nS(){if(Cg)return;Cg=!0;let i=document.createElement("style");i.id="tws-tour-roam-style",i.textContent=`
.tws-tour-guide.is-roam{pointer-events:auto;cursor:grab}
.tws-tour-guide.is-roam:active{cursor:grabbing}
.tws-roam-ripple{position:fixed;z-index:2147483090;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid rgba(122,162,255,.9);pointer-events:none;animation:tws-roam-ripple 600ms ease-out forwards}
@keyframes tws-roam-ripple{0%{transform:scale(.4);opacity:.9}100%{transform:scale(3.4);opacity:0}}
.tws-roam-hint{position:fixed;left:50%;top:18px;transform:translateX(-50%) translateY(-12px);z-index:2147483090;display:flex;align-items:center;gap:9px;max-width:min(560px,92vw);padding:10px 16px;background:rgba(14,16,22,.94);backdrop-filter:blur(10px);border:1px solid rgba(122,162,255,.3);border-radius:99px;color:#e7eaf2;font:600 13px/1.3 system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:0 12px 34px rgba(0,0,0,.45);opacity:0;transition:opacity .3s ease,transform .3s ease;pointer-events:none}
.tws-roam-hint.is-in{opacity:1;transform:translateX(-50%) translateY(0)}
.tws-roam-hint__dot{width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#7aa2ff,#9d7bff);box-shadow:0 0 10px rgba(122,162,255,.8);flex:0 0 auto}
@media (prefers-reduced-motion:reduce){.tws-roam-hint{transition:opacity .2s ease}.tws-roam-ripple{display:none}}
`,document.head.appendChild(i)}var iS=900,sS=2147483280,nd=[1,1.25,1.5,.75],wr=class{constructor(e){this.config=e&&e.keys?e:Rs(e),this.state=Es(this.config),this.curriculum=null,this.playlist=[],this.pos=0,this.index=0,this.track="full",this.paused=!1,this.muted=!1,this.voice=this.config.defaultVoice,this.speed=1,this.mounted=!1,this.offRoute=!1,this.roam=!1,this._runToken=0,this._advanceTimer=0,this._seenSections=new Set,this._beamRaf=0,this._beamActive=!1,this._onKey=this._onKey.bind(this)}async start(e){await this._ensureCurriculum();let t=this.state.readResume();this.track=e||"full",this.voice=t.voice||this.config.defaultVoice,this.speed=t.speed||1,this.muted=!1,this.paused=!1,this._seenSections=new Set,this.playlist=Ts(this.curriculum,this.track),this.pos=0,this.index=this.playlist[0]??0,this.state.writeState({active:!0,index:this.index,track:this.track,voice:this.voice,speed:this.speed,paused:!1,muted:!1});let n=this.curriculum.stops[this.index];if(Qt(n.path)!==Qt()){this._navigate(n.path);return}await this._mount(),this._runCurrent()}async resume(){let e=this.state.readState();if(!e.active)return;await this._ensureCurriculum(),this.paused=e.paused,this.muted=e.muted,this.voice=e.voice||this.config.defaultVoice,this.speed=e.speed||1,this.track=e.track||"full",this.playlist=Ts(this.curriculum,this.track);let t=La(this.curriculum,location.pathname),n=e.index||0;Qt(this.curriculum.stops[n]?.path)===Qt()?(this.index=n,this.offRoute=!1):t>=0?(this.index=t,this.offRoute=!1,this.state.writeState({index:t})):(this.index=n,this.offRoute=!0),this.pos=this._posForAbs(this.index),await this._mount(),this.offRoute?this._showOffRoute():this._runCurrent()}async _ensureCurriculum(){this.curriculum||(this.curriculum=await As(this.config))}async _mount(){this.mounted||(this.mounted=!0,this._suppressCompanion(),this._buildBeam(),this.spotlight=new xr,this.narrator=new vr(this.config),this.avatar=new ll(this.config),await this.avatar.mount(),this.freeRoam=new dl(this.avatar),this.controls=new hl({onMenu:()=>this.panel?.toggle(),onPrev:()=>this._go(this.pos-1),onNext:()=>this._go(this.pos+1),onToggle:()=>this._togglePause(),onSeek:e=>this._go(e),onSpeed:()=>this._cycleSpeed(),onRoam:()=>this._toggleRoam(),onMute:()=>this._toggleMute(),onExit:()=>this.exit()}),this.panel=new ul(this.curriculum,{onJump:e=>this._jumpToAbs(e),onTrack:e=>this._applyTrack(e),onSpeed:e=>this._setSpeed(e),onVoice:e=>this._setVoice(e),onOpenChange:e=>this.controls.setMenuOpen(e)},this.config.voices),this.controls.setMuted(this.muted),this.controls.setPaused(this.paused),this.controls.setSpeed(this.speed),this.panel.setTrack(this.track),this.panel.setSpeed(this.speed),this.panel.setVoice(this.voice),document.addEventListener("keydown",this._onKey))}async _runCurrent(){let e=++this._runToken;clearTimeout(this._advanceTimer),this.offRoute=!1;let t=this.curriculum.stops[this.index];if(!t)return this._finish();if(this._syncControls(),this.panel?.setActive(this.index),this.state.writeState({index:this.index}),t.sectionIntro&&!this._seenSections.has(t.section)&&(this._seenSections.add(t.section),await this.avatar.park(),e!==this._runToken||(this.avatar.point(),await this._present(t.sectionIntro,e),e!==this._runToken)))return;let n=this._resolveTarget(t);if(n){if(await this.spotlight.highlight(n),e!==this._runToken||(await this.avatar.approach(this.spotlight.getRect()||rS(n)),e!==this._runToken))return;this._startBeam()}else if(this.spotlight.highlight(null),this._stopBeam(),await this.avatar.park(),e!==this._runToken)return;this.avatar.point(),await this._narrateAndMaybeAdvance(e)}async _narrateAndMaybeAdvance(e){await this._present(this.curriculum.stops[this.index].narration,e),e===this._runToken&&(this.paused||(this._advanceTimer=setTimeout(()=>{e===this._runToken&&this._advance()},iS/this.speed)))}async _present(e,t){this.avatar.say(e),await this.narrator.speak(e,{muted:this.muted,voice:this.voice,speed:this.speed})}_advance(){if(this.pos+1>=this.playlist.length)return this._finish();this._go(this.pos+1)}_go(e){if(!this.playlist.length)return;this.roam&&(this.roam=!1,this.freeRoam?.disable(),this.controls?.setRoam(!1));let t=Math.max(0,Math.min(this.playlist.length-1,e));this._runToken++,clearTimeout(this._advanceTimer),this.narrator?.cancel(),this.pos=t,this.index=this.playlist[t],this.state.writeState({index:this.index}),this.panel?.setActive(this.index);let n=this.curriculum.stops[this.index];Qt(n.path)===Qt()?this._runCurrent():this._navigate(n.path)}_jumpToAbs(e){this.playlist.indexOf(e)<0&&this._applyTrack("full",{silent:!0}),this._go(this._posForAbs(e))}_togglePause(){if(this.roam)return this._exitRoam();if(this.paused=!this.paused,this.state.writeState({paused:this.paused}),this.controls.setPaused(this.paused),this.paused)clearTimeout(this._advanceTimer),this.narrator.cancel(),this._runToken++;else if(this.offRoute)this._go(this.pos);else{let e=++this._runToken;this._narrateAndMaybeAdvance(e)}}_toggleMute(){if(this.muted=!this.muted,this.state.writeState({muted:this.muted}),this.controls.setMuted(this.muted),this.narrator.cancel(),!this.paused){let e=++this._runToken;this._narrateAndMaybeAdvance(e)}}_applyTrack(e,{silent:t=!1}={}){if(e===this.track)return;let n=this.index;this.track=e,this.playlist=Ts(this.curriculum,e),this.pos=this._posForAbs(n),this.index=this.playlist[this.pos],this.state.writeState({track:e,index:this.index}),this.panel?.setTrack(e),this._syncControls(),t||this._go(this.pos)}_cycleSpeed(){let e=nd.indexOf(this.speed);this._setSpeed(nd[(e+1)%nd.length])}_setSpeed(e){let t=Math.min(2,Math.max(.5,Number(e)||1));if(t!==this.speed&&(this.speed=t,this.state.writeState({speed:t}),this.controls?.setSpeed(t),this.panel?.setSpeed(t),!this.paused&&!this.offRoute&&this.mounted)){let n=++this._runToken;this._narrateAndMaybeAdvance(n)}}_setVoice(e){if(!(!e||e===this.voice)&&(this.voice=e,this.state.writeState({voice:e}),this.panel?.setVoice(e),!this.paused&&!this.offRoute&&this.mounted)){let t=++this._runToken;this._narrateAndMaybeAdvance(t)}}_toggleRoam(){this.roam?this._exitRoam():this._enterRoam()}_enterRoam(){this.roam||(this.roam=!0,this._runToken++,clearTimeout(this._advanceTimer),this.narrator?.cancel(),this._stopBeam(),this.spotlight?.highlight(null),this.avatar?.hideBubble(),this.panel?.close(),this.controls?.setRoam(!0),this.freeRoam?.enable())}_exitRoam(){this.roam&&(this.roam=!1,this.freeRoam?.disable(),this.controls?.setRoam(!1),this.paused=!1,this.controls?.setPaused(!1),this.state.writeState({paused:!1}),this._go(this.pos))}_suppressCompanion(){let e=this.config.companion;if(!e)return;let t=window[e.global];if(!t)return;this._companionWasOn=!!(t.instance?.mounted||t.isEnabled&&t.isEnabled());let n=()=>{try{t.instance?.mounted&&t.instance.unmount()}catch{}};n(),this._onCompanionChange=n,window.addEventListener(e.changeEvent,this._onCompanionChange)}_restoreCompanion(){let e=this.config.companion;if(e&&this._onCompanionChange&&(window.removeEventListener(e.changeEvent,this._onCompanionChange),this._onCompanionChange=null),!e)return;let t=window[e.global];if(!(!t||!this._companionWasOn))try{t.instance?.mounted||(t.instance?t.instance.mount():t.enable?.())}catch{}}_posForAbs(e){let t=this.playlist.indexOf(e);if(t>=0)return t;let n=0,s=1/0;return this.playlist.forEach((r,a)=>{let o=Math.abs(r-e);o<s&&(s=o,n=a)}),n}_showOffRoute(){this._stopBeam(),this.spotlight.highlight(null),this.avatar.park(),this.paused=!0,this.state.writeState({paused:!0}),this.controls.setPaused(!0),this._syncControls(),this.panel?.setActive(this.index),this.avatar.say(this.config.copy.offRoute)}async _finish(){let e=++this._runToken;this._stopBeam(),this.spotlight.highlight(null),await this.avatar.park(),this.avatar.point(),await this._present(this.config.copy.outro,e),e===this._runToken&&(this.state.markCompleted(),this.state.clearState(),document.removeEventListener("keydown",this._onKey),this._showCompletion())}_showCompletion(){let e=this.config.copy.completion,t=document.createElement("div");t.className="tws-tour-done";let n=e.primary?`<a class="tws-tour-done__btn tws-tour-done__btn--primary" href="${cS(e.primary.href)}">${yr(e.primary.label)}</a>`:"";t.innerHTML=`
			<div class="tws-tour-done__inner" role="dialog" aria-label="Tour complete">
				<div class="tws-tour-done__title">${yr(e.title)}</div>
				<p class="tws-tour-done__body">${yr(e.body)}</p>
				<div class="tws-tour-done__actions">
					${n}
					<button class="tws-tour-done__btn" data-act="restart">${yr(e.restartLabel)}</button>
					<button class="tws-tour-done__btn" data-act="close">${yr(e.closeLabel)}</button>
				</div>
			</div>`,lS(),document.body.appendChild(t),requestAnimationFrame(()=>t.classList.add("is-in")),t.addEventListener("click",s=>{let r=s.target.closest("[data-act]")?.dataset.act;r==="restart"?(t.remove(),this.start(this.track)):r==="close"&&(t.remove(),this.exit())}),this._doneCard=t}exit(){this._runToken++,clearTimeout(this._advanceTimer),this.state.clearState(),this._stopBeam(),this._beam?.remove(),document.removeEventListener("keydown",this._onKey),this.roam=!1,this.freeRoam?.disable(),this.narrator?.dispose(),this.spotlight?.dispose(),this.avatar?.dispose(),this.controls?.dispose(),this.panel?.dispose(),this._doneCard?.remove(),this._restoreCompanion(),this.mounted=!1}_resolveTarget(e){let t=[...e.targets||[],"[data-tour-target]","main h1, .hero h1, h1",'a.cta, .btn-primary, button[type="submit"], main a.button, .hero a'];for(let n of t){let s;try{s=document.querySelector(n)}catch{continue}if(aS(s))return s}return null}_buildBeam(){let e=document.createElementNS("http://www.w3.org/2000/svg","svg");e.setAttribute("class","tws-tour-beam"),e.style.cssText=`position:fixed;inset:0;width:100vw;height:100vh;z-index:${sS};pointer-events:none;opacity:0;transition:opacity .3s ease`,e.innerHTML=`
			<defs>
				<marker id="tws-tour-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
					<path d="M0,0 L10,5 L0,10 z" fill="rgba(122,162,255,.95)"/>
				</marker>
			</defs>
			<line class="tws-tour-beam__line" stroke="rgba(122,162,255,.9)" stroke-width="2.5" stroke-dasharray="2 7" stroke-linecap="round" marker-end="url(#tws-tour-arrow)"/>
		`,document.body.appendChild(e),this._beam=e,this._beamLine=e.querySelector(".tws-tour-beam__line")}_startBeam(){if(this._beamActive)return;this._beamActive=!0,this._beam.style.opacity="1";let e=()=>{if(!this._beamActive)return;let t=this.spotlight.getRect(),n=this.avatar.headScreen();if(t&&n){let s=Lg(n.x,t.left,t.left+t.width),r=Lg(n.y,t.top,t.top+t.height);this._beamLine.setAttribute("x1",n.x),this._beamLine.setAttribute("y1",n.y),this._beamLine.setAttribute("x2",s),this._beamLine.setAttribute("y2",r)}this._beamRaf=requestAnimationFrame(e)};this._beamRaf=requestAnimationFrame(e)}_stopBeam(){this._beamActive=!1,cancelAnimationFrame(this._beamRaf),this._beam&&(this._beam.style.opacity="0")}_syncControls(){let e=this.curriculum.stops[this.index];this.controls.update({chapter:Pa(this.curriculum,e.section),index:this.pos,total:this.playlist.length})}_navigate(e){this.config.navigate(e)}_onKey(e){this.panel?.open||oS(e.target)||(e.key===" "||e.key==="k"?(e.preventDefault(),this._togglePause()):e.key==="ArrowRight"?this._go(this.pos+1):e.key==="ArrowLeft"?this._go(this.pos-1):e.key==="m"||e.key==="M"?this._toggleMute():e.key==="c"||e.key==="C"?this.panel?.toggle():e.key==="r"||e.key==="R"?this._toggleRoam():e.key==="Escape"&&(this.roam?this._exitRoam():this.exit()))}};function Lg(i,e,t){return Math.min(t,Math.max(e,i))}function rS(i){let e=i.getBoundingClientRect();return{left:e.left,top:e.top,width:e.width,height:e.height,cx:e.left+e.width/2,cy:e.top+e.height/2}}function aS(i){if(!i||!i.isConnected)return!1;let e=i.getBoundingClientRect();if(e.width<4||e.height<4)return!1;let t=getComputedStyle(i);return t.visibility!=="hidden"&&t.display!=="none"&&Number(t.opacity)>.05}function oS(i){if(!i)return!1;let e=i.tagName;return e==="INPUT"||e==="TEXTAREA"||e==="SELECT"||i.isContentEditable}function yr(i){return String(i??"").replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e])}function cS(i){return yr(i)}var Pg=!1;function lS(){if(Pg)return;Pg=!0;let i=document.createElement("style");i.textContent=`
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
`,document.head.appendChild(i)}var Ig=2147483400,Mr=class{constructor(e,t){this.config=e,this.curriculum=t,this.movement=e.mode==="platformer"?"platformer":"stroll",this.spotlight=null,this.narrator=null,this.stops=[],this.pg=null,this.running=!1,this._reduced=matchMedia("(prefers-reduced-motion: reduce)").matches,this._onPgExit=()=>{this.running&&this.exit()},this._onPgMode=()=>{this.running&&this._hudState&&this._setHud(...this._hudState)}}isActive(){return this.running}async start(){if(this.running)return;this.running=!0;let e=Qt(),t=(this.curriculum?.stops||[]).filter(n=>!n.path||Qt(n.path)===e);if(this.stops=t.map(n=>({stop:n,el:this._resolveTarget(n)})).filter(n=>n.el),!this.stops.length){this._toast("Nothing to explore on this page yet."),this.exit();return}this.spotlight=new xr,this.narrator=new vr(this.config),this._buildHud(),xi(),window.scrollTo({top:0,behavior:"auto"}),this.pg=cl({mode:this.movement,config:this._walkConfig(),avatarId:this.config.guideAvatarId,checkpoints:this.stops.map(n=>({el:n.el})),onReach:(n,s)=>this._reach(n,s),onComplete:()=>this._finish()}),window.addEventListener("walk-playground:exit",this._onPgExit),window.addEventListener("walk-playground:mode",this._onPgMode),this._activate(0)}exit(){this.running=!1,window.removeEventListener("walk-playground:exit",this._onPgExit),window.removeEventListener("walk-playground:mode",this._onPgMode);try{xi()}catch{}this.pg=null,this.narrator?.cancel?.(),this.spotlight?.dispose(),this.spotlight=null,this._hud?.remove(),this._hud=null}async _reach(e,t){let{stop:n,el:s}=this.stops[e];if(this._setHud(e,!0),await this.spotlight.highlight(s),await this.narrator.speak(n.narration,{muted:!1,voice:this.config.defaultVoice,speed:1}),!this.running)return;this.spotlight.highlight(null);let r=e+1;r<this.stops.length&&this._activate(r),t()}_activate(e){this._setHud(e,!1)}_finish(){this.spotlight?.highlight(null),this._setHud(this.stops.length-1,!1,!0)}_buildHud(){let e=document.createElement("div");e.className="tws-cp-hud",e.innerHTML=`
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
			<button class="tws-cp-hud__exit" id="tws-cp-exit" aria-label="Exit">\u2715 Exit</button>`,Dg(),document.body.appendChild(e),this._hud=e,e.querySelector("#tws-cp-dots").innerHTML=this.stops.map(()=>"<i></i>").join(""),e.querySelector("#tws-cp-exit").addEventListener("click",()=>this.exit()),e.querySelector("#tws-cp-mode").addEventListener("click",()=>qi()),this._reachedCount=0,this._syncMode()}_syncMode(){if(!this._hud)return;let e=Ea()==="platformer",t=this._hud.querySelector("#tws-cp-mode-ic"),n=this._hud.querySelector("#tws-cp-mode-name");t&&(t.textContent=e?"\u{1F3AE}":"\u{1F6B6}"),n&&(n.textContent=e?"Platformer":"Stroll")}_setHud(e,t,n=!1){if(!this._hud)return;this._hudState=[e,t,n],this._syncMode();let s=this.stops.length;t&&(this._reachedCount=Math.max(this._reachedCount||0,e+1));let r=n?s:this._reachedCount||0,a=this._hud.querySelector("#tws-cp-count"),o=this._hud.querySelector("#tws-cp-msg");if([...this._hud.querySelectorAll("#tws-cp-dots i")].forEach((l,h)=>{l.classList.toggle("done",h<r),l.classList.toggle("active",h===e&&h>=r)}),n){a.textContent="\u{1F389} All done",o.textContent=`You found all ${s} spots. Press \u2715 to finish.`;return}a.textContent=`\u{1F3AF} ${r} / ${s}`,o.textContent=t?this.stops[e].stop.title||"Here we are":this._instruction()}_instruction(){let e=Ea()==="platformer";return this._touch()?e?"Use the buttons to run and jump to the glowing checkpoint.":"Use the joystick to walk to the glowing checkpoint.":e?"Arrow keys to run, Space to jump \u2014 reach the glowing checkpoint.":"Use arrow keys to walk to the glowing checkpoint."}_touch(){return matchMedia("(pointer: coarse)").matches||"ontouchstart"in window}_walkConfig(){return Wi({assetBase:this.config.assetBase||"",apiBase:this.config.apiBase||"",manifestUrl:this.config.manifestUrl||"/animations/manifest.json",defaultAvatarId:this.config.guideAvatarId||"realistic-female"})}_resolveTarget(e){let t=[...e.targets||[],"[data-tour-target]","main h1, .hero h1, h1",'a.cta, .btn-primary, button[type="submit"], main a.button, .hero a'];for(let n of t){let s;try{s=document.querySelector(n)}catch{continue}if(hS(s))return s}return null}_toast(e){let t=document.createElement("div");t.className="tws-cp-toast",t.textContent=e,Dg(),document.body.appendChild(t),requestAnimationFrame(()=>t.classList.add("is-in")),setTimeout(()=>{t.classList.remove("is-in"),setTimeout(()=>t.remove(),300)},2600)}};function hS(i){if(!i||!i.isConnected)return!1;let e=i.getBoundingClientRect();if(e.width<4||e.height<4)return!1;let t=getComputedStyle(i);return t.visibility!=="hidden"&&t.display!=="none"&&Number(t.opacity)>.05}var kg=!1;function Dg(){if(kg||typeof document>"u")return;kg=!0;let i=document.createElement("style");i.id="tws-tour-explore-hud",i.textContent=`
.tws-cp-hud{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:${Ig};display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 18px;background:rgba(14,16,22,.94);backdrop-filter:blur(12px);border:1px solid rgba(122,162,255,.28);border-radius:16px;color:#e7eaf2;font:600 13px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.5);max-width:min(520px,94vw)}
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
.tws-cp-toast{position:fixed;left:50%;top:20px;transform:translateX(-50%) translateY(-10px);z-index:${Ig};padding:11px 18px;background:rgba(14,16,22,.95);border:1px solid rgba(122,162,255,.3);border-radius:12px;color:#e7eaf2;font:600 13px/1.3 system-ui,sans-serif;opacity:0;transition:.3s;box-shadow:0 10px 30px rgba(0,0,0,.5)}
.tws-cp-toast.is-in{opacity:1;transform:translateX(-50%) translateY(0)}
`,document.head.appendChild(i)}var uS=["Here we have","Next up,","This is","Take a look at","Now,","Let's visit","Over here is","Here's","Meet","And this \u2014","Check out","This one is"];function Ug(i,e={}){let t=Array.isArray(i?.sections)?i.sections:[],n=e.sectionIntros||{},s=e.sectionHeroes||{},r=e.targets||{},a=new Set(e.deny||[]),o=e.denyPrefix||[],c=e.skipAuthRequired!==!1,l=Number.isFinite(e.quickPerSection)?e.quickPerSection:3,h=e.connectors?.length?e.connectors:uS,u=e.wpm||150,d=e.stopOverheadS??9,f=e.sectionOrder?.length?e.sectionOrder:t.map(S=>S.id),g=new Map;for(let S of t){let R=(S.pages||[]).filter(b=>b&&b.path&&!(c&&b.auth==="required")&&!a.has(b.path)&&!o.some(T=>b.path.startsWith(T)));R.length&&g.set(S.id,{meta:S,pages:R})}let _=[],m=[],p=0,x=0,y=0;for(let S of f){let R=g.get(S);if(!R)continue;let b=dS(s[S]||[],R.pages),T=n[S]||"";m.push({id:S,title:R.meta.title||gS(S),intro:T}),b.forEach((P,C)=>{let N=C===0,G=C<l,q=fS(P,_.length,h),F=N&&T?T.split(/\s+/).length:0,H=q.split(/\s+/).length+F;p+=H,G&&(x+=H,y+=1),_.push({id:mS(P.path),path:P.path,section:S,title:fl(P.title),narration:q,highlight:G,...N&&T?{sectionIntro:T}:{},...r[P.path]?{targets:r[P.path]}:{}})})}let w=Fg(p,_.length,u,d),A=Math.max(1,Fg(x,y,u,d));return{version:2,generatedBy:"@three-ws/tour buildCurriculum",title:e.title||"Guided Tour",tagline:e.tagline||"A 3D guide walks you through every feature, live, on the real site.",estimatedMinutes:w,stopCount:_.length,tracks:[{id:"full",title:"Full tour",description:"Every feature, chapter by chapter.",stopCount:_.length,estimatedMinutes:w},{id:"quick",title:"Quick highlights",description:"The best of every chapter, in a few minutes.",stopCount:y,estimatedMinutes:A}],sections:m,stops:_}}function dS(i,e){let t=new Map(i.map((n,s)=>[n,s]));return[...e].sort((n,s)=>{let r=t.has(n.path)?t.get(n.path):1/0,a=t.has(s.path)?t.get(s.path):1/0;if(r!==a)return r-a;let o=n.added||"",c=s.added||"";return o!==c?o<c?1:-1:(n.title||"").localeCompare(s.title||"")})}function fS(i,e,t){let n=t[e%t.length],s=fl(i.title),r=fl(i.description||""),a=new RegExp(`^${pS(s)}\\s*[\u2014:-]\\s*`,"i");return r=r.replace(a,""),r=Ng(r),`${n} ${Ng(s).replace(/\.$/,"")}. ${r}`.trim()}function Fg(i,e,t,n){return Math.round(i/t+e*n/60)}function fl(i){return String(i||"").replace(/\s+/g," ").trim()}function Ng(i){return i=fl(i),i&&(/[.!?]$/.test(i)?i:i+".")}function pS(i){return i.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function mS(i){return String(i).replace(/^\/+/,"").replace(/\/+$/,"").replace(/[^a-z0-9]+/gi,"-").toLowerCase()||"home"}function gS(i){return String(i||"").replace(/[-_]+/g," ").replace(/\b\w/g,e=>e.toUpperCase())}var _S="0.5.2";function id(i={}){let e=Rs(i),t=Es(e),n=null,s=null,r=()=>n||(n=new wr(e)),a=()=>e.mode==="explore"||e.mode==="platformer";async function o(){if(s?.isActive())return;let l=e.curriculum&&typeof e.curriculum=="object"?e.curriculum:await As(e);return s=new Mr(e,l),s.start()}let c={get director(){return n},get explore(){return s},get config(){return e},isActive(){return s?.isActive()===!0||t.readState().active===!0},start(l){return a()?o():r().start(l)},startExplore:o,resume(){return a()?o():r().resume()},exit(){s?.exit(),n?.exit()},bootstrap(){if(typeof window>"u"||window.top!==window.self)return;let l=new URLSearchParams(location.search),h=l.get(e.deepLinkParam);h==="start"?a()?o():r().start(l.get("track")==="quick"?"quick":"full"):h==="0"?c.exit():(h==="1"||!a()&&t.readState().active)&&c.resume()}};return c}var bS="https://three.ws",xS="https://three.ws/animations/manifest.json";function Og(){if(window.__featureTour)return;let i=document.currentScript||document.querySelector("script[data-tour]");if(!i||!i.hasAttribute("data-tour"))return;let e=i.dataset;if(!e.curriculum){console.warn('[three-ws/tour] <script data-tour> needs data-curriculum="<url>"');return}let t=id({curriculum:e.curriculum,guideAvatarId:e.avatar||"realistic-female",assetBase:e.assetBase||bS,manifestUrl:e.manifestUrl||xS,ttsEndpoint:e.ttsEndpoint||null,mode:e.mode==="explore"||e.mode==="platformer"?e.mode:"guided"});window.__featureTour=t,t.bootstrap();let n=s=>{for(let r of s.querySelectorAll("[data-tour-start]"))r.__twsTourWired||(r.__twsTourWired=!0,r.addEventListener("click",a=>{a.preventDefault(),t.start(r.getAttribute("data-tour-start")==="quick"?"quick":"full")}))};n(document),new MutationObserver(()=>n(document)).observe(document.body,{childList:!0,subtree:!0}),e.autostart&&t.start(e.autostart==="quick"?"quick":"full")}typeof window<"u"&&(document.readyState==="loading"?document.addEventListener("DOMContentLoaded",Og,{once:!0}):Og());return $g(vS);})();
if(typeof window!=="undefined"){window.createFeatureTour=ThreeWsTour.createFeatureTour;}
