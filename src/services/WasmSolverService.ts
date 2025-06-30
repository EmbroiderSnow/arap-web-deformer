// src/services/WasmSolverService.ts

// The types are declared globally in `arap.d.ts`.
let scriptLoadingPromise: Promise<void> | null = null;

const loadArapScript = (): Promise<void> => {
    if (typeof createArapModule !== 'undefined') return Promise.resolve();
    if (scriptLoadingPromise) return scriptLoadingPromise;

    scriptLoadingPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/arap.js'; 
        script.async = true;
        script.onload = () => resolve();
        script.onerror = (error) => {
            console.error('Failed to load arap.js script.', error);
            scriptLoadingPromise = null;
            reject(new Error('Failed to load arap.js'));
        };
        document.body.appendChild(script);
    });
    
    return scriptLoadingPromise;
};


class WasmSolverService {
    private static instance: WasmSolverService;
    private controller: ArapController | null = null;
    // 我们现在存储的是构造函数，而不是模块本身
    private ArapController_constructor: ArapControllerConstructor | null = null;
    
    private constructor() {}

    public static getInstance(): WasmSolverService {
        if (!WasmSolverService.instance) {
            WasmSolverService.instance = new WasmSolverService();
        }
        return WasmSolverService.instance;
    }

    public async init(): Promise<void> {
        if (this.ArapController_constructor) {
            console.log('WasmSolverService already initialized.');
            return;
        }

        try {
            await loadArapScript();
            const module = await createArapModule({
                locateFile: (path: string) => path.endsWith('.wasm') ? '/arap.wasm' : path
            });
            this.ArapController_constructor = module.ArapController;
            console.log('ARAP Wasm module loaded successfully.');
        } catch (error) {
            console.error('Error during WASM module initialization:', error);
            throw error;
        }
    }
    
    // 公共API `loadMesh` 保持不变，App.tsx 无需修改
    public loadMesh(vertices: Float32Array, faces: Int32Array): void {
        if (!this.ArapController_constructor) {
            throw new Error('WasmSolverService is not initialized. Call init() first.');
        }

        // 内部实现改变：在这里创建新的 C++ Controller 实例
        if (this.controller) {
            this.controller.delete(); // 清理旧的实例
        }
        this.controller = new this.ArapController_constructor(vertices, faces);
        console.log('ArapController instance created with new mesh.');
    }

    public setHandles(handleIndices: Int32Array, handlePositions: Float32Array): void {
        if (!this.controller) throw new Error('Controller not created. Call loadMesh() first.');
        this.controller.set_handles(handleIndices, handlePositions);
    }

    public solve(maxIterations: number): void {
        if (!this.controller) throw new Error('Controller not created. Call loadMesh() first.');
        this.controller.solve(maxIterations);
    }

    public getVertices(): Float32Array | null {
        if (!this.controller) throw new Error('Controller not created. Call loadMesh() first.');
        return this.controller.get_vertices();
    }

    public cleanup(): void {
        if (this.controller) {
            this.controller.delete();
            this.controller = null;
        }
        this.ArapController_constructor = null;
    }
}

export default WasmSolverService.getInstance();