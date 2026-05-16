import { useEffect, useRef } from 'react'

// ── Fragment shader — WebGL2 GLSL ES 3.0 ──────────────────────────────────
const fragmentShaderSource = `#version 300 es
precision highp float;
out vec4 O;
uniform float time;
uniform vec2 resolution;
uniform vec3 u_color;

#define FC gl_FragCoord.xy
#define R resolution
#define T (time+660.)

float rnd(vec2 p){p=fract(p*vec2(12.9898,78.233));p+=dot(p,p+34.56);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(rnd(i),rnd(i+vec2(1,0)),u.x),mix(rnd(i+vec2(0,1)),rnd(i+1.),u.x),u.y);}
float fbm(vec2 p){float t=.0,a=1.;for(int i=0;i<5;i++){t+=a*noise(p);p*=mat2(1,-1.2,.2,1.2)*2.;a*=.5;}return t;}

void main(){
  vec2 uv=(FC-.5*R)/R.y;
  vec3 col=vec3(1);
  uv.x+=.25;
  uv*=vec2(2,1);

  float n=fbm(uv*.28-vec2(T*.01,0));
  n=noise(uv*3.+n*2.);

  col.r-=fbm(uv+vec2(0,T*.015)+n);
  col.g-=fbm(uv*1.003+vec2(0,T*.015)+n+.003);
  col.b-=fbm(uv*1.006+vec2(0,T*.015)+n+.006);

  col=mix(col, u_color, dot(col,vec3(.21,.71,.07)));

  col=mix(vec3(.08),col,min(time*.1,1.));
  col=clamp(col,.08,1.);
  O=vec4(col,1);
}`

const vertexSrc  = '#version 300 es\nprecision highp float;\nin vec4 position;\nvoid main(){gl_Position=position;}'
const VERTS      = [-1, 1, -1, -1, 1, 1, 1, -1]

// ── Utility ────────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? [parseInt(result[1], 16) / 255, parseInt(result[2], 16) / 255, parseInt(result[3], 16) / 255]
    : null
}

// ── Renderer class ─────────────────────────────────────────────────────────
class Renderer {
  constructor(canvas, fragmentSource) {
    this.canvas  = canvas
    this.gl      = canvas.getContext('webgl2')
    this.program = null
    this.vs      = null
    this.fs      = null
    this.buffer  = null
    this.color   = [0.5, 0.5, 0.5]
    this.setup(fragmentSource)
    this.init()
  }

  updateColor(newColor) {
    this.color = newColor
  }

  updateScale() {
    const dpr = Math.max(1, window.devicePixelRatio)
    this.canvas.width  = window.innerWidth  * dpr
    this.canvas.height = window.innerHeight * dpr
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
  }

  compile(shader, source) {
    const gl = this.gl
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader))
    }
  }

  setup(fragmentSource) {
    const gl  = this.gl
    this.vs   = gl.createShader(gl.VERTEX_SHADER)
    this.fs   = gl.createShader(gl.FRAGMENT_SHADER)
    const prg = gl.createProgram()
    if (!this.vs || !this.fs || !prg) return
    this.compile(this.vs, vertexSrc)
    this.compile(this.fs, fragmentSource)
    this.program = prg
    gl.attachShader(this.program, this.vs)
    gl.attachShader(this.program, this.fs)
    gl.linkProgram(this.program)
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(this.program))
    }
  }

  init() {
    const { gl, program } = this
    if (!program) return
    this.buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(VERTS), gl.STATIC_DRAW)
    const pos = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(pos)
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)
    // Store uniform locations on the program object
    program.uResolution = gl.getUniformLocation(program, 'resolution')
    program.uTime       = gl.getUniformLocation(program, 'time')
    program.uColor      = gl.getUniformLocation(program, 'u_color')
  }

  render(now = 0) {
    const { gl, program, buffer, canvas } = this
    if (!program || !gl.isProgram(program)) return
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.uniform2f(program.uResolution, canvas.width, canvas.height)
    gl.uniform1f(program.uTime, now * 1e-3)
    gl.uniform3fv(program.uColor, this.color)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  reset() {
    const { gl, program, vs, fs } = this
    if (!program) return
    if (vs) { gl.detachShader(program, vs); gl.deleteShader(vs) }
    if (fs) { gl.detachShader(program, fs); gl.deleteShader(fs) }
    gl.deleteProgram(program)
    this.program = null
  }
}

// ── React component ────────────────────────────────────────────────────────
export default function SmokeBackground({ smokeColor = '#808080' }) {
  const canvasRef   = useRef(null)
  const rendererRef = useRef(null)

  // Initialise renderer + animation loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new Renderer(canvas, fragmentShaderSource)
    rendererRef.current = renderer

    const handleResize = () => renderer.updateScale()
    handleResize()
    window.addEventListener('resize', handleResize)

    let rafId
    const loop = (now) => {
      renderer.render(now)
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)

    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(rafId)
      renderer.reset()
    }
  }, [])

  // Update color when prop changes
  useEffect(() => {
    if (!rendererRef.current) return
    const rgb = hexToRgb(smokeColor)
    if (rgb) rendererRef.current.updateColor(rgb)
  }, [smokeColor])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  )
}
