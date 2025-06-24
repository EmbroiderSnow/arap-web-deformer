import { useEffect, useRef, useState } from 'react';
import { Canvas, useLoader, useFrame } from '@react-three/fiber';
import { Bounds, Environment, TransformControls, OrbitControls } from '@react-three/drei';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import './App.css';
import * as THREE from 'three';

// 将模型加载和处理逻辑封装在一个单独的组件中
function Model({ modelScale = 1 }: { modelScale?: number }) {
  const obj = useLoader(OBJLoader, '/model.obj');
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // 如果模型部分没有材质，则赋予一个默认材质
        if (!child.material) {
          child.material = new THREE.MeshStandardMaterial({
            color: 'lightgray',
            roughness: 0.8,
            metalness: 0.1,
          });
        }
        // 重新计算法线以保证光照正确
        child.geometry.computeVertexNormals();
      }
    });
  }, [obj]);

  // 使用 useFrame 来实时更新模型的缩放
  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.scale.set(modelScale, modelScale, modelScale);
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={obj} />
    </group>
  );
}

function Scene({ modelScale }: { modelScale: number }) {
  return (
    // TransformControls 包裹 Bounds
    // 这样 TransformControls 会作用于 Bounds 调整后的整个场景
    <TransformControls size={1.6} mode="rotate" showX={true} showY={true} showZ={true}>
      <Bounds fit clip observe={false} margin={1.2}>
        <Model modelScale={modelScale} />
      </Bounds>
    </TransformControls>
  );
}

function App() {
  const [modelScale, setModelScale] = useState(1);

  return (
    <div
      className="App"
      style={{ width: '100vw', height: '100vh' }}
      // 将 onWheel 事件移到 Canvas 上，以防止与页面滚动冲突
    >
      <Canvas
        onWheel={(event) => {
          // 阻止事件冒泡到父级 div
          event.stopPropagation();
          const zoomSpeed = 0.001;
          // 使用函数式更新，以获取最新的 state
          setModelScale((prevScale) => {
            const newScale = prevScale - event.deltaY * zoomSpeed;
            const minScale = 0.5;
            const maxScale = 3.0;
            return Math.max(minScale, Math.min(newScale, maxScale));
          });
        }}
      >
        <Environment preset="studio" />
        {/* <ambientLight intensity={0.5} /> */}
        <directionalLight position={[5, 10, 5]} intensity={1.5} />

        {/* 建议添加 OrbitControls 以方便观察，它会自动处理与 TransformControls 的冲突 */}
        <OrbitControls makeDefault />

        <Scene modelScale={modelScale} />
      </Canvas>
    </div>
  );
}

export default App;