/* Voice Studio - the orb. A 3D voice-reactive presence, engineered to be
 * nearly free so it can NEVER make the voice slower.
 *
 * LIGHT BY DESIGN
 * ---------------
 * - No libraries. Three.js alone is ~600KB and a full scene graph; this is one
 *   canvas, one shader, ~250 lines, ~8KB.
 * - Renders into a small offscreen-size canvas (max 288px) and lets CSS
 *   upscale it. The GPU shades <= 83k pixels per frame - trivial - and the
 *   upscale is free and actually looks softer and better.
 * - One requestAnimationFrame loop, and ONLY while the tab is visible. The
 *   moment the tab hides, the loop stops dead: zero battery, zero contention
 *   with the audio thread, which is the only thread that matters here.
 * - All smoothing is exponential and allocation-free in the frame loop.
 * - Fallback ladder: WebGL shader -> 2D canvas particle sphere -> plain CSS
 *   gradient (the .orb element has a gradient background regardless, so even
 *   with JS fully broken the page still shows a beautiful static orb).
 * - prefers-reduced-motion renders a single static frame, no loop.
 *
 * It is driven by REAL audio, not animation pretending to be audio:
 *   mic(rms)     caller loudness, fed from the capture path (~20-60ms)
 *   speaking(on) the agent's voice is playing
 *   state(name)  "idle" | "listening" | "thinking" | "speaking"
 */
(function () {
  "use strict";

  var VERT =
    "attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}";

  /* One sphere, shaded per pixel: fbm surface that swells with loudness,
   * fresnel rim so it reads as 3D glass, palette per conversational state. */
  var FRAG =
    "precision mediump float;" +
    "uniform vec2 u_res;uniform float u_time,u_amp,u_state;" +
    "float hash(vec3 p){p=fract(p*0.3183099+vec3(0.1,0.2,0.3));p*=17.0;" +
    "return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}" +
    "float noise(vec3 x){vec3 i=floor(x);vec3 f=fract(x);f=f*f*(3.0-2.0*f);" +
    "return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x)," +
    "mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y)," +
    "mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x)," +
    "mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}" +
    "float fbm(vec3 p){float v=0.0;float a=0.5;for(int k=0;k<4;k++){v+=a*noise(p);p*=2.02;a*=0.5;}return v;}" +
    "void main(){" +
    "vec2 uv=(gl_FragCoord.xy*2.0-u_res)/min(u_res.x,u_res.y);" +
    "float r=length(uv);" +
    "vec3 c1=u_state<0.5?vec3(0.42,0.55,1.0):u_state<1.5?vec3(0.24,0.88,0.68):u_state<2.5?vec3(0.98,0.76,0.30):vec3(0.58,0.48,1.0);" +
    "vec3 c2=u_state<0.5?vec3(0.62,0.36,0.96):u_state<1.5?vec3(0.20,0.66,1.00):u_state<2.5?vec3(1.00,0.52,0.36):vec3(0.34,0.82,1.00);" +
    "float sp=0.35+u_amp*1.7;" +
    "float n=fbm(normalize(vec3(uv,0.6))*2.3+vec3(0.0,0.0,u_time*0.25));" +
    "float rad=0.62+(n-0.5)*0.17*sp+u_amp*0.10;" +
    "float d=r-rad;" +
    "float body=smoothstep(0.012,-0.012,d);" +
    "vec3 nrm=normalize(vec3(uv,sqrt(max(rad*rad-min(r,rad)*min(r,rad),0.0))+0.15));" +
    "float lit=0.55+0.45*dot(nrm,normalize(vec3(-0.5,0.8,0.6)));" +
    "float fres=pow(1.0-max(nrm.z,0.0),2.2);" +
    "float glow=exp(-max(d,0.0)*4.5)*(0.30+u_amp*0.9);" +
    "vec3 col=mix(c1,c2,n)*body*lit+c2*fres*0.85*body+c1*glow;" +
    "col+=c2*exp(-abs(d)*9.0)*0.22*(0.6+u_amp);" +
    "col+=vec3(0.030,0.036,0.070)*(1.0-smoothstep(0.2,1.25,r));" +
    "gl_FragColor=vec4(col,1.0);}";

  var REDUCED = false;
  try {
    REDUCED = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) { REDUCED = false; }

  var canvas = null, gl = null, ctx2d = null, prog = null, uni = {};
  var mode = "none";           // "gl" | "2d"
  var raf = 0, running = false;
  var amp = 0, target = 0;     // smoothed loudness
  var speakAmp = 0;
  var stateVal = 0;            // shader state number
  var t0 = 0;
  var SIZE = 288;              // internal render size cap - the lightness trick
  var PTS = null;              // 2d fallback lattice

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  function initGL() {
    try {
      gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power" }) ||
           canvas.getContext("experimental-webgl");
    } catch (e) { gl = null; }
    if (!gl) return false;
    var vs = compile(gl.VERTEX_SHADER, VERT);
    var fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { gl = null; return false; }
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl = null; return false; }
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    uni.res = gl.getUniformLocation(prog, "u_res");
    uni.time = gl.getUniformLocation(prog, "u_time");
    uni.amp = gl.getUniformLocation(prog, "u_amp");
    uni.state = gl.getUniformLocation(prog, "u_state");
    return true;
  }

  function init2D() {
    ctx2d = canvas.getContext && canvas.getContext("2d");
    if (!ctx2d) return false;
    // Fibonacci sphere lattice: a real 3D point set we rotate and project.
    PTS = [];
    var N = 240, ga = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < N; i++) {
      var y = 1 - (i / (N - 1)) * 2;
      var rad = Math.sqrt(Math.max(0, 1 - y * y));
      var th = ga * i;
      PTS.push([Math.cos(th) * rad, y, Math.sin(th) * rad]);
    }
    return true;
  }

  function resize() {
    if (!canvas) return;
    var host = canvas.parentElement;
    var css = Math.min(host ? host.clientWidth : 320, 340) || 320;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var px = Math.min(Math.round(css * dpr * 0.5), SIZE); // half-res, CSS upscales
    if (canvas.width !== px) {
      canvas.width = px;
      canvas.height = px;
      if (gl) gl.viewport(0, 0, px, px);
    }
    canvas.style.width = css + "px";
    canvas.style.height = css + "px";
  }

  function frame(now) {
    if (!running) return;
    var t = (now - t0) / 1000;
    // Idle breath: a live thing is never perfectly still. Amplitude eases
    // toward its target; speech adds its own energy on top.
    var idle = 0.10 + 0.05 * Math.sin(t * 1.4) + 0.02 * Math.sin(t * 2.3);
    var want = Math.max(target, speakAmp > 0 ? speakAmp : 0, idle);
    amp += (want - amp) * 0.12;

    if (mode === "gl") {
      gl.uniform2f(uni.res, canvas.width, canvas.height);
      gl.uniform1f(uni.time, t);
      gl.uniform1f(uni.amp, amp);
      gl.uniform1f(uni.state, stateVal);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else if (mode === "2d") {
      var w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2;
      var R = (w * 0.31) * (1 + amp * 0.45);
      ctx2d.clearRect(0, 0, w, h);
      var rot = t * 0.5, ca = Math.cos(rot), sa = Math.sin(rot);
      var hue = stateVal === 1 ? 160 : stateVal === 2 ? 38 : stateVal === 3 ? 250 : 222;
      for (var i = 0; i < PTS.length; i++) {
        var p = PTS[i];
        var x = p[0] * ca - p[2] * sa, z = p[0] * sa + p[2] * ca, y = p[1];
        var pr = 1 / (1.9 - z * 0.8);
        var px = cx + x * R * pr * 1.6, py = cy + y * R * pr * 1.6;
        var a = 0.18 + (z + 1) * 0.34;
        var s = (1.1 + (z + 1) * 1.4) * (1 + amp * 1.2);
        ctx2d.fillStyle = "hsla(" + hue + ",85%," + (58 + z * 12) + "%," + a + ")";
        ctx2d.beginPath();
        ctx2d.arc(px, py, s, 0, 6.2832);
        ctx2d.fill();
      }
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || mode === "none") return;
    if (document.hidden && !REDUCED) return;
    running = true;
    if (REDUCED) {           // one considered frame, then hold still
      running = false;
      frameOnce();
      return;
    }
    t0 = performance.now() - 1;
    raf = requestAnimationFrame(frame);
  }

  function frameOnce() {
    var keep = running;
    running = true;
    frame(performance.now());
    cancelAnimationFrame(raf);
    running = keep;
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  var orb = {
    mount: function (el) {
      canvas = el;
      if (!canvas) return;
      resize();
      if (initGL()) mode = "gl";
      else if (init2D()) mode = "2d";
      else mode = "none";
      if (window.addEventListener) {
        window.addEventListener("resize", function () { resize(); if (REDUCED) frameOnce(); }, { passive: true });
        document.addEventListener("visibilitychange", function () {
          if (document.hidden) stop(); else start();
        });
      }
      start();
    },
    mic: function (rms) {
      // Perceptual compression: sqrt keeps whispers visible without letting
      // shouts pin the needle.
      target = Math.max(0, Math.min(1, Math.sqrt(Math.max(0, rms)) * 2.6));
    },
    speaking: function (on) {
      speakAmp = on ? 0.45 : 0;
      if (on) orb.state("speaking");
    },
    state: function (name) {
      stateVal = name === "listening" ? 1 : name === "thinking" ? 2 :
                 name === "speaking" ? 3 : 0;
      if (name === "idle") { target = 0; speakAmp = 0; }
      if (REDUCED) frameOnce();
    },
    level: function () { return amp; },
    mode: function () { return mode; },
  };

  window.VoiceOrb = orb;
})();
