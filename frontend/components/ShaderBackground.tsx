'use client';

import { useEffect, useState } from 'react';
import ShaderBackgroundWebGPU from './ShaderBackgroundWebGPU';
import ShaderBackgroundWebGL from './ShaderBackgroundWebGL';

export default function ShaderBackground() {
    const [hasWebGPU, setHasWebGPU] = useState<boolean | null>(null);

    useEffect(() => {
        let alive = true;

        if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
        setHasWebGPU(false);
        return;
        }

        navigator.gpu
        .requestAdapter()
        .then((adapter) => {
            if (alive) setHasWebGPU(adapter !== null);
        })
        .catch(() => {
            if (alive) setHasWebGPU(false);
        });

        return () => {
        alive = false;
        };
    }, []);

    if (hasWebGPU === null) {
        return (
        <div className="absolute inset-0 bg-white pointer-events-none" aria-hidden="true" />
        );
    }

    return hasWebGPU ? <ShaderBackgroundWebGPU /> : <ShaderBackgroundWebGL />;
}