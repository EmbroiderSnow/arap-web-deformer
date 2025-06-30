// src/wasm/arap.d.ts

/**
 * 描述由C++ Deform 库封装而来的 ArapController 实例。
 */
interface ArapController {
  set_handles(handle_indices: Int32Array, handle_positions: Float32Array): void;
  solve(max_iterations: number): void;
  get_vertices(): Float32Array | null;
  // Emscripten 自动为所有绑定的类添加 delete() 方法用于内存释放
  delete(): void; 
}

/**
 * 描述 ArapController 的构造函数。
 * 它现在需要在创建实例时就提供网格数据。
 */
interface ArapControllerConstructor {
  new (vertices: Float32Array, faces: Int32Array): ArapController;
}

/**
 * 声明由 arap.js 创建的全局工厂函数。
 */
declare function createArapModule(options?: any): Promise<{
  ArapController: ArapControllerConstructor;
}>;