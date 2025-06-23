import React, { useRef, useState } from 'react';
import { Canvas, useLoader, useFrame } from '@react-three/fiber';
import { Bounds, Environment } from '@react-three/drei';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import './App.css'; 
import * as THREE from 'three';

function Scene({ modelScale = 1 }: { modelScale?: number }) {
  const obj = useLoader(OBJLoader, '/model.obj');
  const modelRef = useRef<THREE.Group>(null);

  const [isDragging, setIsDragging] = useState(false);
  const lastMousePosition = useRef({ x: 0, y: 0 });

  React.useEffect(() => {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (!child.material) {
          child.material = new THREE.MeshStandardMaterial({ color: 'lightgray', roughness: 0.8, metalness: 0.1 });
        }
        child.geometry.computeVertexNormals();
      }
    })
  }, [obj]);

  useFrame(() => {
    if (modelRef.current) {
      modelRef.current.scale.set(modelScale, modelScale, modelScale);
    }
  });

  const handlePointerDown = (event: React.PointerEvent) => {
    setIsDragging(true);
    lastMousePosition.current = { x: event.clientX, y: event.clientY };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!isDragging || !modelRef.current) return;

    const deltaX = event.clientX - lastMousePosition.current.x;
    const deltaY = event.clientY - lastMousePosition.current.y;

    const rotationSpeed = 0.005; // Adjust rotation speed as needed
    modelRef.current.rotation.y += deltaX * rotationSpeed;
    modelRef.current.rotation.x += deltaY * rotationSpeed;

    lastMousePosition.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    setIsDragging(false);
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
  };

  return (
    <Bounds fit clip observe={false} margin={1.2}>
      <primitive
        object={obj} 
        ref={modelRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </Bounds>
  );
}

function App() {
  const [modelScale, setModelScale] = useState(1);

  return (
    <div 
      className="App" 
      style={{ width: '100vw', height: '100vh'}}
      onWheel={(event) => {
        event.preventDefault();
        const zoomSpeed = 0.001; 
        const newScale = modelScale - event.deltaY * zoomSpeed;
        console.log("newScale: ", newScale);
        const minScale = 0.5;
        const maxScale = 3.0;
        setModelScale(Math.max(minScale, Math.min(newScale, maxScale)));
      }}
    >
        <Canvas
          // onWheel={e => e.stopPropagation()}
        >
          <Environment preset="studio" />
          {/* <ambientLight intensity={0.1} /> */}
          <directionalLight position={[5, 10, 5]} intensity={1} />

          {/* <OrbitControls makeDefault/> */}

          <Scene modelScale={modelScale}/>

          <axesHelper args={[200]} />
        </Canvas>
    </div>
  );
}

export default App;