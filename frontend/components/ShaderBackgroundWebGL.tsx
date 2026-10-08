'use client';

import { useEffect, useRef, useState } from 'react';
import { Renderer, Program, Mesh, Triangle } from 'ogl';

const vert = /* glsl */ `
    attribute vec2 uv;
    attribute vec2 position;
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position, 0.0, 1.0);
    }
`;

const frag = /* glsl */ `
    precision highp float;

    uniform float uTime;
    uniform vec2  uResolution;
    varying vec2  vUv;

    float strandY(float x, float phase, float t, float amp, float speed) {
        float y = 0.0;
        y += sin(x * 1.15 + t * speed + phase)             * amp;
        y += sin(x * 0.55 - t * speed * 0.7 + phase * 1.7) * amp * 0.65;
        y += sin(x * 2.10 + t * speed * 1.3 + phase * 0.5) * amp * 0.28;
        return y;
    }

    vec3 strandColor(float x) {
        float u = clamp(x * 0.6 + 0.5, 0.0, 1.0);
        vec3 c1 = vec3(0.000, 0.898, 1.000);
        vec3 c2 = vec3(0.357, 0.549, 1.000);
        vec3 c3 = vec3(0.420, 0.769, 1.000);
        vec3 c4 = vec3(0.145, 0.694, 0.910);
        if (u < 0.34) return mix(c1, c2, u / 0.34);
        if (u < 0.67) return mix(c2, c3, (u - 0.34) / 0.33);
        return mix(c3, c4, (u - 0.67) / 0.33);
    }

    float strandMask(float d, float thickness) {
        return 1.0 - smoothstep(0.0, thickness, d);
    }

    vec3 blendStrand(vec3 col, vec2 p, float phase, float offset,
                    float thickness, float t, float amp, float speed) {
        float ab = 0.0035;
        float yR = strandY(p.x + ab, phase, t, amp, speed) + offset;
        float yG = strandY(p.x,      phase, t, amp, speed) + offset;
        float yB = strandY(p.x - ab, phase, t, amp, speed) + offset;

        float mR = strandMask(abs(p.y - yR), thickness);
        float mG = strandMask(abs(p.y - yG), thickness);
        float mB = strandMask(abs(p.y - yB), thickness);

        vec3 c = strandColor(p.x);

        vec3 result;
        result.r = mix(col.r, c.r, mR);
        result.g = mix(col.g, c.g, mG);
        result.b = mix(col.b, c.b, mB);
        return result;
    }

    void main() {
        vec2 uv = vUv;
        float aspect = uResolution.x / uResolution.y;
        vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
        float t = uTime;

        vec3 col = vec3(1.0);

        col = blendStrand(col, p, 0.4,  0.16, 0.0035, t, 0.075, 0.30);
        col = blendStrand(col, p, 2.3, -0.02, 0.0038, t, 0.075, 0.30);
        col = blendStrand(col, p, 4.7, -0.22, 0.0035, t, 0.075, 0.30);

        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
`;

export default function ShaderBackgroundWebGL() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [supported, setSupported] = useState(true);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let renderer: Renderer;
        try {
        renderer = new Renderer({
            dpr: Math.min(window.devicePixelRatio, 2),
            alpha: false,
        });
        } catch {
        setSupported(false);
        return;
        }

        const gl = renderer.gl;
        gl.canvas.style.width = '100%';
        gl.canvas.style.height = '100%';
        gl.canvas.style.display = 'block';
        container.appendChild(gl.canvas);

        const geometry = new Triangle(gl);
        const program = new Program(gl, {
        vertex: vert,
        fragment: frag,
        uniforms: {
            uTime: { value: 0 },
            uResolution: { value: [1, 1] },
        },
        });
        const mesh = new Mesh(gl, { geometry, program });

        function resize() {
        const w = container.clientWidth;
        const h = container.clientHeight;
        renderer.setSize(w, h);
        program.uniforms.uResolution.value = [w * renderer.dpr, h * renderer.dpr];
        }
        resize();
        window.addEventListener('resize', resize);

        let raf = 0;
        const start = performance.now();
        function loop() {
        const t = (performance.now() - start) / 1000;
        program.uniforms.uTime.value = t;
        renderer.render({ scene: mesh });
        raf = requestAnimationFrame(loop);
        }
        raf = requestAnimationFrame(loop);

        return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', resize);
        if (gl.canvas.parentNode === container) container.removeChild(gl.canvas);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        };
    }, []);

    if (!supported) {
        return (
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-white via-sky-50 to-cyan-50" />
        );
    }

    return (
        <div
        ref={containerRef}
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        />
    );
}