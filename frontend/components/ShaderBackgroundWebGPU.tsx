'use client';

import {
    Shader,
    ChromaticAberration,
    Engraving,
    InkFlow,
    Shatter,
    Strands,
    Ripples
} from 'shaders/react';

export default function ShaderBackgroundWebGPU() {
    return (
        <div className="absolute inset-0 pointer-events-none">
        <Shader>
            <Ripples
                colorA="#e3e3e3"
                colorB="#dbdbdb"
                frequency={1}
                phase={3.4}
                speed={0.7}
                thickness={0.1} />
            <Engraving
                contrast={3}
                frequency={29}
                inkColor="#007cff"
                paperColor="#ffffff"
                relief={2}
                style="spiral"
                visible={true}
                waviness={0}>
                <InkFlow
                color="#0e77e8"
                colorMode="single"
                decay={0.3}
                force={0.45}
                momentum={1}
                opacity={0.5}
                radius={0.1} />
                <ChromaticAberration />
            </Engraving>
            <Strands
                amplitude={3.3}
                colorScale={2}
                colorSpeed={0.05}
                colorVariance={0.8}
                lineCount={3}
                lineWidth={0}
                speed={0.1}
                spread={0.5}
                stops={[{ color: "#00e5ff", position: 0 }, { color: "#5b8cff", position: 0.34 }, { color: "#6bc4ff", position: 0.67 }, { color: "#25b1e8", position: 1 }]} />
            <Shatter
                chromaticSplit={5}
                crackWidth={2.4}
                decay={10}
                intensity={5}
                radius={0.3}
                refractionStrength={10}
                shardLighting={0.4} />
            </Shader>


        </div>
    );
}