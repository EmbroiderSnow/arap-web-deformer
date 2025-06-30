// src/App.tsx

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { Environment, TransformControls, OrbitControls } from '@react-three/drei';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { Layout, Button, Collapse, Radio, Typography, Spin, Alert } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import './App.css';

import WasmSolverService from './services/WasmSolverService';

const { Sider, Content } = Layout;
const { Panel } = Collapse;
const { Title } = Typography;

type ModelProps = {
  onModelLoad: (geometry: THREE.BufferGeometry) => void;
  handlePositions: Map<number, THREE.Vector3>;
  anchorIndices?: number[];
};

const Model = forwardRef(
  function Model(
    { onModelLoad, handlePositions, anchorIndices }: ModelProps,
    ref: React.Ref<any>
  ) {
    const obj = useLoader(OBJLoader, '/model.obj');
    const groupRef = useRef<THREE.Group>(null);
    const handlesGroupRef = useRef<THREE.Group>(null);
    const [initialScale, setInitialScale] = useState(0);
    const modelLoadedRef = useRef(false);
    const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

    useEffect(() => {
      if (obj && !modelLoadedRef.current) {
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.computeVertexNormals();
            onModelLoad(child.geometry);
            setGeometry(child.geometry);
            modelLoadedRef.current = true;
          }
        });

        const bbox = new THREE.Box3().setFromObject(obj);
        const center = bbox.getCenter(new THREE.Vector3());
        obj.position.sub(center);

        const size = bbox.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const desiredSize = 5;
        const scaleFactor = desiredSize / maxDim;
        
        if (isFinite(scaleFactor)) {
          setInitialScale(scaleFactor);
        }
      }
    }, [obj, onModelLoad]);

    useImperativeHandle(ref, () => ({
      getVertexWorldPosition: (index: number) => {
        if (!geometry || !groupRef.current) return null;
        const position = new THREE.Vector3();
        position.fromBufferAttribute(geometry.attributes.position, index);
        return groupRef.current.localToWorld(position);
      },
      getHandlesGroup: () => handlesGroupRef.current,
      getModelGroup: () => groupRef.current, 
      updateVertices: (newVertices: Float64Array) => {
        if (!geometry) return;
        
        const positionAttribute = geometry.attributes.position as THREE.BufferAttribute;
        positionAttribute.copyArray(new Float32Array(newVertices));
        positionAttribute.needsUpdate = true;
        geometry.computeVertexNormals(); 
      },
    }));

    return (
      <group ref={groupRef} scale={[initialScale, initialScale, initialScale]}>
        {initialScale > 0 && <primitive object={obj} />}
        <group ref={handlesGroupRef}>
          {Array.from(handlePositions.entries()).map(([index, pos]: [number, THREE.Vector3]) => {
              const localPos = groupRef.current ? groupRef.current.worldToLocal(pos.clone()) : pos;
              const isAnchor = anchorIndices?.includes(index);
              const color = isAnchor ? "#c70000" : "gold";
              const emissive = isAnchor ? "#ff3d3d" : "#ffc700";

              return (
                <mesh key={index} position={localPos} userData={{ handleIndex: index }}>
                  <sphereGeometry args={[0.25, 32, 32]} />
                  <meshStandardMaterial color={color} emissive={emissive} />
                </mesh>
              );
          })}
        </group>
      </group>
    );
  }
);

function DeformationController({ mode, modelRef, onHandleMove, handleVertexSelected, handleAnchorSelected }: any) {
  const { camera, gl } = useThree();
  const dragState = useRef({
    isDragging: false,
    handleIndex: -1,
    plane: new THREE.Plane(),
  }).current;

  const findNearestVertexIndex = useCallback((worldPoint: THREE.Vector3, geometry: THREE.BufferGeometry, modelGroup: THREE.Group) => {
    if (!geometry || !modelGroup) return -1;
    
    const vertices = geometry.attributes.position;
    let minDistanceSq = Infinity;
    let nearestVertexIndex = -1;
    const vertexWorldPos = new THREE.Vector3();

    for (let i = 0; i < vertices.count; i++) {
      vertexWorldPos.fromBufferAttribute(vertices, i);
      modelGroup.localToWorld(vertexWorldPos);
      
      const distanceSq = vertexWorldPos.distanceToSquared(worldPoint);
      if (distanceSq < minDistanceSq) {
        minDistanceSq = distanceSq;
        nearestVertexIndex = i;
      }
    }
    return nearestVertexIndex;
  }, []);

  const onPointerDown = useCallback((event: PointerEvent) => {
    if (!modelRef.current) return;

    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    if (mode === 'select') {
      const modelGroup = modelRef.current.getModelGroup();
      if (!modelGroup) return;
      
      const intersects = raycaster.intersectObject(modelGroup, true);
      if (intersects.length > 0) {
        const intersectPoint = intersects[0].point;
        const geometry = (intersects[0].object as THREE.Mesh).geometry;
        const vertexIndex = findNearestVertexIndex(intersectPoint, geometry, modelGroup);
        if (vertexIndex !== -1) {
          if (event.altKey) {
            handleVertexSelected(vertexIndex);
          } else if (event.ctrlKey || event.metaKey) {
            handleAnchorSelected(vertexIndex); 
          }
        }
      }
    } else if (mode === 'deform') {
      const handlesGroup = modelRef.current.getHandlesGroup();
      if (!handlesGroup) return;
      
      const intersects = raycaster.intersectObject(handlesGroup, true);
      if (intersects.length > 0) {
        const draggedObject = intersects[0].object;
        dragState.isDragging = true;
        dragState.handleIndex = draggedObject.userData.handleIndex;
        const handleWorldPos = new THREE.Vector3();
        draggedObject.getWorldPosition(handleWorldPos);
        const cameraDirection = camera.getWorldDirection(new THREE.Vector3());
        dragState.plane.setFromNormalAndCoplanarPoint(cameraDirection, handleWorldPos);
        gl.domElement.style.cursor = 'grabbing';
      }
    }
  }, [mode, modelRef, camera, gl.domElement, dragState, findNearestVertexIndex, handleVertexSelected, handleAnchorSelected]);

  const onPointerMove = useCallback((event: PointerEvent) => {
    if (!dragState.isDragging || mode !== 'deform') return;
    
    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const intersectionPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragState.plane, intersectionPoint);
    
    if (intersectionPoint) {
      onHandleMove(dragState.handleIndex, intersectionPoint);
    }
  }, [camera, gl.domElement, dragState, onHandleMove, mode]);

  const onPointerUp = useCallback(() => {
    if (dragState.isDragging) {
      dragState.isDragging = false;
      dragState.handleIndex = -1;
      gl.domElement.style.cursor = 'auto';
    }
  }, [gl.domElement, dragState]);

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [gl.domElement, onPointerDown, onPointerMove, onPointerUp]);

  return null;
}

function App() {
  const [mode, setMode] = useState<'view' | 'select' | 'deform'>('view');
  const [handleIndices, setHandleIndices] = useState<number[]>([]);
  const [anchorIndices, setAnchorIndices] = useState<number[]>([]);
  const [handlePositions, setHandlePositions] = useState<Map<number, THREE.Vector3>>(new Map());
  const [isWasmReady, setWasmReady] = useState(false);
  const [wasmError, setWasmError] = useState<string | null>(null);
  const [loadedGeometry, setLoadedGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [isOrbitEnabled, setIsOrbitEnabled] = useState(true);
  const [transformTarget, setTransformTarget] = useState<THREE.Object3D | null>(null);

  const modelRef = useRef<any>(null);
  const transformControlsRef = useRef<any>(null);
  const animationFrameId = useRef<number | null>(null);
  const latestDragInfo = useRef<{ index: number; pos: THREE.Vector3 } | null>(null);

  useEffect(() => {
    WasmSolverService.init()
      .then(() => {
        setWasmReady(true);
      })
      .catch(error => {
        console.error("Failed to initialize WasmSolverService:", error);
        setWasmError('Failed to load the core deformation engine. Please try refreshing the page.');
      });

    return () => {
      WasmSolverService.cleanup();
    };
  }, []);

  useEffect(() => {
    if (isWasmReady && loadedGeometry) {
      try {
        let cleanGeometry: THREE.BufferGeometry;
        // Using mergeVertices is a robust way to ensure the geometry is indexed and has no duplicate vertices.
        if (!loadedGeometry.index) {
          console.warn('Geometry is non-indexed. Merging vertices to create index.');
        }
        cleanGeometry = BufferGeometryUtils.mergeVertices(loadedGeometry);
      
        const vertices = new Float32Array(cleanGeometry.attributes.position.array);
        const faces = new Int32Array(cleanGeometry.index!.array);

        WasmSolverService.loadMesh(vertices, faces);
      } catch (error) {
        console.error('Error loading mesh into Wasm solver:', error);
        setWasmError('An error occurred while processing the model.');
      }
    }
  }, [isWasmReady, loadedGeometry]);

  useEffect(() => {
    if (modelRef.current) {
        setTransformTarget(modelRef.current.getModelGroup());
    }
  }, [loadedGeometry]);

  const handleTransformEnd = useCallback(() => {
    if (!modelRef.current) return;
    
    const allIndices = [...new Set([...handleIndices, ...anchorIndices])];
    const newPositions = new Map<number, THREE.Vector3>();

    allIndices.forEach(index => {
      const newWorldPos = modelRef.current.getVertexWorldPosition(index);
      if (newWorldPos) {
        newPositions.set(index, newWorldPos);
      }
    });
    setHandlePositions(newPositions);
  }, [handleIndices, anchorIndices]);

  useEffect(() => {
    const controls = transformControlsRef.current;
    if (controls) {
      const handleDraggingChanged = (event: any) => {
        setIsOrbitEnabled(!event.value);
      };
      controls.addEventListener('dragging-changed', handleDraggingChanged);
      controls.addEventListener('mouseUp', handleTransformEnd);

      return () => {
        controls.removeEventListener('dragging-changed', handleDraggingChanged);
        controls.removeEventListener('mouseUp', handleTransformEnd);
      };
    }
  }, [transformTarget, handleTransformEnd]);

  const handleVertexSelected = (index: number) => {
    if (!modelRef.current) return;
    const initialPos = modelRef.current.getVertexWorldPosition(index);
    if (!initialPos) return;
    
    setHandleIndices(prev => prev.includes(index) ? prev : [...prev, index]);
    setHandlePositions(prev => new Map(prev).set(index, initialPos));
  };

  const handleAnchorSelected = (index: number) => {
    if (!modelRef.current) return;
    if (handleIndices.includes(index)) {
        console.warn(`Vertex ${index} is already a handle and cannot be an anchor.`);
        return;
    }
    const initialPos = modelRef.current.getVertexWorldPosition(index);
    if (!initialPos) return;

    setAnchorIndices(prev => prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]);
    setHandlePositions(prev => {
        const newPositions = new Map(prev);
        newPositions.has(index) ? newPositions.delete(index) : newPositions.set(index, initialPos);
        return newPositions;
    });
  };
  
  const clearSelection = () => {
      setHandleIndices([]);
      setAnchorIndices([]);
      setHandlePositions(new Map());
  }

  const runDeformation = () => {
    if (!latestDragInfo.current || !isWasmReady) {
      animationFrameId.current = null;
      return;
    }
    const { index: draggedIndex, pos: draggedPos } = latestDragInfo.current;

    const allConstraints = new Map<number, THREE.Vector3>();
    anchorIndices.forEach(anchorIndex => {
        const anchorPos = handlePositions.get(anchorIndex);
        if(anchorPos) allConstraints.set(anchorIndex, anchorPos);
    });
    
    handleIndices.forEach(handleIndex => {
        if (handleIndex === draggedIndex) {
            allConstraints.set(handleIndex, draggedPos);
        } else {
            const handlePos = handlePositions.get(handleIndex);
            if (handlePos) allConstraints.set(handleIndex, handlePos);
        }
    });

    const indices = new Int32Array(Array.from(allConstraints.keys()));
    const modelGroup = modelRef.current.getModelGroup();
    if (!modelGroup) {
        console.error("Could not get model group for coordinate conversion.");
        animationFrameId.current = null;
        return;
    }

    const positionsLocal = Array.from(allConstraints.values()).map(worldPos => modelGroup.worldToLocal(worldPos.clone()));
    const positions = new Float32Array(positionsLocal.flatMap(p => [p.x, p.y, p.z]));
    
    const containsInvalidNumbers = (arr: Float32Array | Int32Array) => !arr.every(num => isFinite(num));
    if (containsInvalidNumbers(indices) || containsInvalidNumbers(positions)) {
      console.error('FATAL: Invalid numbers (NaN or Infinity) detected in data being sent to WASM!');
      return; 
    }

    WasmSolverService.setHandles(indices, positions);
    WasmSolverService.solve(50);
    const newAllVertices = WasmSolverService.getVertices();

    if (newAllVertices) {
      modelRef.current.updateVertices(newAllVertices);

      const newAllConstraintPositionsWorld = new Map<number, THREE.Vector3>();
      const allConstraintIndices = [...handleIndices, ...anchorIndices];

      allConstraintIndices.forEach(constraintIndex => {
          const i = constraintIndex * 3;
          const localPos = new THREE.Vector3(newAllVertices[i], newAllVertices[i+1], newAllVertices[i+2]);
          const worldPos = modelGroup.localToWorld(localPos.clone());
          newAllConstraintPositionsWorld.set(constraintIndex, worldPos);
      });
      setHandlePositions(newAllConstraintPositionsWorld);
    } else {
        console.error('Wasm solver did not return any vertices.');
    }

    animationFrameId.current = null;
  };

  const handleMove = (draggedIndex: number, newPosition: THREE.Vector3) => {
    latestDragInfo.current = { index: draggedIndex, pos: newPosition };
    if (!animationFrameId.current) {
      animationFrameId.current = requestAnimationFrame(runDeformation);
    }
  };

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider width={260} style={{ background: '#fff', padding: '24px 16px 0 16px', boxShadow: '2px 0 8px #f0f1f2' }}>
        <Title level={4} style={{ marginBottom: 24 }}>ARAP-Deformer</Title>
        <Button type="primary" icon={<UploadOutlined />} block style={{ marginBottom: 24 }}>
          Upload Model
        </Button>
        <Collapse defaultActiveKey={['1']} ghost>
          <Panel header="Mode Selection" key="1">
            <Radio.Group
              value={mode}
              onChange={e => setMode(e.target.value)}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <Radio value="view">View Mode</Radio>
              <Radio value="select">Select Mode</Radio>
              <Radio value="deform">Deform Mode</Radio>
            </Radio.Group>
            {(mode === 'select' && (handleIndices.length > 0 || anchorIndices.length > 0)) && (
                <Button onClick={clearSelection} style={{marginTop: 12}} block>
                  Clear Selection
              </Button>
            )}
          </Panel>
        </Collapse>
      </Sider>
       <Layout>
        <Content style={{ height: '100vh', background: '#f5f6fa', padding: 0, position: 'relative' }}>
          {!isWasmReady && !wasmError && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10 }}>
              <Spin size="large" tip="Loading Engine..." />
            </div>
          )}
          {wasmError && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10, width: 300 }}>
              <Alert message="Error" description={wasmError} type="error" showIcon />
            </div>
          )}
          <div className="App" style={{ width: '100%', height: '100vh', opacity: isWasmReady ? 1 : 0.5 }}>
            <Canvas>
              <Environment preset="studio" />
              <directionalLight position={[5, 10, 5]} intensity={1.5} />
              
              {transformTarget && (
                <TransformControls
                  size={1.6}
                  ref={transformControlsRef}
                  object={transformTarget}
                  mode="rotate"
                  enabled={mode === 'view'}
                  showX={true}
                  showY={true}
                  showZ={true}
                />
              )}

              <Model
                ref={modelRef}
                onModelLoad={setLoadedGeometry}
                handlePositions={handlePositions}
                anchorIndices={anchorIndices}
              />
              
              <OrbitControls makeDefault enabled={isOrbitEnabled && mode !== 'deform'} />

              <DeformationController 
                mode={mode}
                modelRef={modelRef}
                onHandleMove={handleMove}
                handleVertexSelected={handleVertexSelected}
                handleAnchorSelected={handleAnchorSelected} 
              />
            </Canvas>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;