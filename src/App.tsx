// src/App.tsx

import { useEffect, useRef, useState, useCallback } from 'react';
import { forwardRef, useImperativeHandle } from 'react';
import { Canvas, useLoader, useFrame, useThree } from '@react-three/fiber';
import { Environment, TransformControls, OrbitControls } from '@react-three/drei';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import './App.css';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { Layout, Button, Collapse, Radio, Typography, Spin, Alert } from 'antd';
import { UploadOutlined } from '@ant-design/icons';

// 1. 导入 WasmSolverService 的单例
import WasmSolverService from './services/WasmSolverService';

const { Sider, Content } = Layout;
const { Panel } = Collapse;
const { Title } = Typography;

// 1. 为 Model 组件的 props 定义一个清晰的类型
type ModelProps = {
  onModelLoad: (geometry: THREE.BufferGeometry) => void;
  handlePositions: Map<number, THREE.Vector3>;
  anchorIndices?: number[]; // 可选的锚点索引
};

// 将模型加载和处理逻辑封装在一个单独的组件中
const Model = forwardRef(
  function Model(
    { onModelLoad, handlePositions, anchorIndices }: ModelProps,
    ref: React.Ref<any>
  ) {
    const obj = useLoader(OBJLoader, '/model.obj');
    const groupRef = useRef<THREE.Group>(null);
    const handlesGroupRef = useRef<THREE.Group>(null);
    const [initialScale, setInitialScale] = useState(0);
    const modelLoadedRef = useRef(false); // 用于防止重复调用 onModelLoad
    const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

    useEffect(() => {
      if (obj && !modelLoadedRef.current) {
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.computeVertexNormals();
            if (onModelLoad) {
              onModelLoad(child.geometry);
            }
            setGeometry(child.geometry); // 保存几何体
            modelLoadedRef.current = true;
          }
        });

        // 仅居中模型，缩放操作交给父级 group
        const bbox = new THREE.Box3().setFromObject(obj);
        const center = bbox.getCenter(new THREE.Vector3());
        obj.position.sub(center);

        // 计算正确的缩放比例并存入 state
        const size = bbox.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const desiredSize = 5; // 期望模型大致占据的场景大小
        const scaleFactor = desiredSize / maxDim;
        
        // 只有当 scaleFactor 是一个有效的有限数时才更新 state
        if (isFinite(scaleFactor)) {
          setInitialScale(scaleFactor);
        }
      }
    }, [obj, onModelLoad]);

    // 2. 暴露组件内部的接口给父组件
    useImperativeHandle(ref, () => ({
      // 获取顶点在世界坐标系中的初始位置
      getVertexWorldPosition: (index: number) => {
        if (!geometry || !groupRef.current) return null;
        const position = new THREE.Vector3();
        position.fromBufferAttribute(geometry.attributes.position, index);
        return groupRef.current.localToWorld(position);
      },
      // 获取包含所有小红球的 Group
      getHandlesGroup: () => handlesGroupRef.current,
      getModelGroup: () => groupRef.current, 
      updateVertices: (newVertices: Float64Array) => {
        // DEBUG: 确认此函数是否被调用
        console.log('[Model] updateVertices a été appelé. Mise à jour de la géométrie.')
        if (!geometry) return;
        
        // Wasm返回的是Float64Array, 但Three.js的BufferAttribute需要Float32Array
        // 因此需要进行一次转换
        const positionAttribute = geometry.attributes.position as THREE.BufferAttribute;
        positionAttribute.copyArray(new Float32Array(newVertices));
        
        // 关键：通知Three.js顶点数据已更新，需要在下一帧重新渲染
        positionAttribute.needsUpdate = true;
        // 如果模型有复杂的着色或光照，重新计算法线可以获得更好的视觉效果
        geometry.computeVertexNormals(); 
      },
    }));

    const finalScale = initialScale ;

    // DEBUG: 调试信息，查看有多少控制点需要被渲染
    console.log(`[Model Render] Rendering ${handlePositions.size} handles.`);

    return (
      <group ref={groupRef} scale={[finalScale, finalScale, finalScale]}>
        {initialScale > 0 && <primitive object={obj} />}
        {/* 3. 渲染控制点小球 */}
        <group ref={handlesGroupRef}>
          {Array.from(handlePositions.entries()).map(([index, pos]: [number, THREE.Vector3]) => {
              const localPos = groupRef.current ? groupRef.current.worldToLocal(pos.clone()) : pos;
              
              // 根据点是否在 anchorIndices 中来决定颜色
              const isAnchor = anchorIndices?.includes(index);
              const color = isAnchor ? "#c70000" : "gold"; // 锚点为红色，拖拽点为金色
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

// DeformationController: 处理变形模式下的所有交互
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

  // onPointerDown 现在处理所有模式
  const onPointerDown = useCallback((event: PointerEvent) => {
    if (!modelRef.current) return;

    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    // --- 恢复的选择模式逻辑 ---
    if (mode === 'select') {
      if (event.altKey) {
        const modelGroup = modelRef.current.getModelGroup();
        if (!modelGroup) return;
        
        const intersects = raycaster.intersectObject(modelGroup, true);
        if (intersects.length > 0) {
          const intersectPoint = intersects[0].point;
          const geometry = (intersects[0].object as THREE.Mesh).geometry;
          const vertexIndex = findNearestVertexIndex(intersectPoint, geometry, modelGroup);
          if (vertexIndex !== -1) {
            handleVertexSelected(vertexIndex);
          }
        }
      }
      else if (event.ctrlKey || event.metaKey) {
        const modelGroup = modelRef.current.getModelGroup();
        if (!modelGroup) return;
        
        const intersects = raycaster.intersectObject(modelGroup, true);
        if (intersects.length > 0) {
            const intersectPoint = intersects[0].point;
            const geometry = (intersects[0].object as THREE.Mesh).geometry;
            const vertexIndex = findNearestVertexIndex(intersectPoint, geometry, modelGroup);
            if (vertexIndex !== -1) {
              // 需要一个新的函数来处理锚点选择
              handleAnchorSelected(vertexIndex); 
            }
        }
      }
    // --- 变形模式逻辑 (不变) ---
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
  }, [mode, modelRef, camera, gl.domElement, dragState, findNearestVertexIndex, handleVertexSelected]);

  // onPointerMove (不变)
  const onPointerMove = useCallback((event: PointerEvent) => {
    if (!dragState.isDragging || mode !== 'deform') return; // 增加模式检查
    // ... rest of the function is the same
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
      // DEBUG: 确认 onHandleMove 是否被调用，以及传递的数据是什么
      console.log(`[Controller] onPointerMove appelle onHandleMove avec l'index : ${dragState.handleIndex}`, intersectionPoint.toArray());
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

  return null; // 此组件不渲染任何可见内容
}

function App() {
  const [mode, setMode] = useState<'view' | 'select' | 'deform'>('view');
  const [handleIndices, setHandleIndices] = useState<number[]>([]);
  const [anchorIndices, setAnchorIndices] = useState<number[]>([]); // <-- 新增：存储锚点索引
  const [handlePositions, setHandlePositions] = useState<Map<number, THREE.Vector3>>(new Map());

  const modelRef = useRef<any>(null);
  const [isWasmReady, setWasmReady] = useState(false);
  const [wasmError, setWasmError] = useState<string | null>(null);
  const [loadedGeometry, setLoadedGeometry] = useState<THREE.BufferGeometry | null>(null);

  const [isOrbitEnabled, setIsOrbitEnabled] = useState(true);
  const [transformTarget, setTransformTarget] = useState<THREE.Object3D | null>(null);
  const transformControlsRef = useRef<any>(null);

  const animationFrameId = useRef<number | null>(null);
  const latestDragInfo = useRef<{ index: number; pos: THREE.Vector3 } | null>(null);

  // 4. Effect Hook: 用于初始化和清理 Wasm 服务
  useEffect(() => {
    console.log('Attempting to initialize WasmSolverService...');
    WasmSolverService.init()
      .then(() => {
        console.log('WasmSolverService initialized successfully.');
        setWasmReady(true);
      })
      .catch(error => {
        console.error("Failed to initialize WasmSolverService:", error);
        setWasmError('Failed to load the core deformation engine. Please try refreshing the page.');
      });

    // 返回一个清理函数，在组件卸载时执行
    return () => {
      console.log('Cleaning up WasmSolverService.');
      WasmSolverService.cleanup();
    };
  }, []); // 空依赖数组意味着这个 effect 只在组件挂载和卸载时运行一次

  // 5. Effect Hook: 当 Wasm 和模型都准备好后，将模型数据加载到求解器
  useEffect(() => {
    // 检查 Wasm 是否就绪以及模型几何体是否已加载
    if (isWasmReady && loadedGeometry) {
      console.log('Wasm is ready and geometry is loaded. Loading mesh into solver...');
      try {
        // 从 BufferGeometry 中提取顶点数据
        let cleanGeometry: THREE.BufferGeometry;

        // --- FIX START: 处理非索引几何体 ---
        // 检查几何体是否拥有索引
        if (!loadedGeometry.index) {
          console.warn('Geometry is non-indexed. Generating a robust index by merging vertices.');
          // toIndexed() 在较新版本中被 mergeVertices() 取代或行为合并
          // mergeVertices 是处理非索引几何体的标准方法
          cleanGeometry = BufferGeometryUtils.mergeVertices(loadedGeometry);
      } else {
          // 如果已经有索引，我们仍然可以运行一次 mergeVertices 来清理任何可能的重复顶点。
          console.log('Geometry is indexed. Running mergeVertices to ensure topology is clean.');
          cleanGeometry = BufferGeometryUtils.mergeVertices(loadedGeometry);
      }
      
      // 2. 从清理后的几何体中提取顶点和面
      const vertices = new Float32Array(cleanGeometry.attributes.position.array); // <-- 同样使用 Float64Array
      const faces = new Int32Array(cleanGeometry.index!.array); // cleanGeometry 保证有索引
        // --- FIX END ---

        // 调用服务加载网格
        WasmSolverService.loadMesh(vertices, faces);
        console.log(`Mesh loaded into Wasm: ${vertices.length / 3} vertices, ${faces.length / 3} faces.`);

      } catch (error) {
        console.error('Error loading mesh into Wasm solver:', error);
        setWasmError('An error occurred while processing the model.');
      }
    }
  }, [isWasmReady, loadedGeometry]); // 依赖项不变

  useEffect(() => {
    if (modelRef.current) {
        setTransformTarget(modelRef.current.getModelGroup());
    }
  }, [loadedGeometry]); // 使用 loadedGeometry 作为模型加载完成的标志

  const handleTransformEnd = useCallback(() => {
    if (!modelRef.current) return;
    
    console.log('[App] Transform ended. Updating handle positions...');

    // 使用所有当前选中的点（拖拽点和锚点）的索引
    const allIndices = [...new Set([...handleIndices, ...anchorIndices])];
    const newPositions = new Map<number, THREE.Vector3>();

    // 遍历所有索引，获取它们在模型经过新的变换后的世界坐标
    allIndices.forEach(index => {
      // getVertexWorldPosition 内部已经包含了 updateMatrixWorld(true) 的调用，确保获取的是最新坐标
      const newWorldPos = modelRef.current.getVertexWorldPosition(index);
      if (newWorldPos) {
        newPositions.set(index, newWorldPos);
      }
    });

    // 用最新的、正确的世界坐标更新 React state
    setHandlePositions(newPositions);
  }, [handleIndices, anchorIndices]); // 依赖项确保函数能访问到最新的索引列表

  // 2. 修改 useEffect，为 TransformControls 添加和移除事件监听器
  useEffect(() => {
    const controls = transformControlsRef.current;
    if (controls) {
      const handleDraggingChanged = (event: any) => {
        setIsOrbitEnabled(!event.value);
      };

      // 添加拖拽状态变化监听 (用于禁用 OrbitControls)
      controls.addEventListener('dragging-changed', handleDraggingChanged);
      
      // 添加变换结束监听 (用于更新控制点位置)
      controls.addEventListener('mouseUp', handleTransformEnd);

      // 清理函数
      return () => {
        controls.removeEventListener('dragging-changed', handleDraggingChanged);
        controls.removeEventListener('mouseUp', handleTransformEnd);
      };
    }
  }, [transformTarget, handleTransformEnd]);

   // MODIFIED: handleVertexSelected now includes debugging info
  const handleVertexSelected = (index: number) => {
    if (!modelRef.current) {
        console.error('[App] handleVertexSelected called but modelRef is null.');
        return;
    }
    console.log(`[App] handleVertexSelected received index: ${index}`);
    
    const initialPos = modelRef.current.getVertexWorldPosition(index);
    if (!initialPos) {
        console.error(`[App] Could not get world position for vertex index: ${index}`);
        return;
    }
    
    console.log('[App] Updating handleIndices and handlePositions states...');
    setHandleIndices(prev => {
        const newIndices = prev.includes(index) ? prev : [...prev, index];
        console.log('[App] New handleIndices:', newIndices);
        return newIndices;
    });
    setHandlePositions(prev => {
        const newPositions = new Map(prev).set(index, initialPos);
        return newPositions;
    });
  };

  const handleAnchorSelected = (index: number) => {
    if (!modelRef.current) return;

    // 如果一个点已经是拖拽点，则不能同时成为锚点
    if (handleIndices.includes(index)) {
        console.warn(`Vertex ${index} is already a handle and cannot be an anchor.`);
        return;
    }

    const initialPos = modelRef.current.getVertexWorldPosition(index);
    if (!initialPos) return;

    // 切换锚点状态
    setAnchorIndices(prev => 
        prev.includes(index) 
        ? prev.filter(i => i !== index) 
        : [...prev, index]
    );

    // 锚点也需要存储其初始位置，用于约束
    setHandlePositions(prev => {
        const newPositions = new Map(prev);
        if (newPositions.has(index)) {
            newPositions.delete(index);
        } else {
            newPositions.set(index, initialPos);
        }
        return newPositions;
    });
  };
  
  // 6. 清空选择时，同时清空 handleIndices 和 handlePositions
  const clearSelection = () => {
      setHandleIndices([]);
      setHandlePositions(new Map());
  }

  const runDeformation = () => {
    // DEBUG: 确认此函数是否被 requestAnimationFrame 调用
    console.log('[runDeformation] Exécution de la frame de déformation.');

    if (!latestDragInfo.current || !isWasmReady) {
      animationFrameId.current = null;
      return;
    }

    const { index: draggedIndex, pos: draggedPos } = latestDragInfo.current;

    // 1. 创建所有约束点的 Map
    // 从 handlePositions 复制所有锚点的初始位置
    const allConstraints = new Map<number, THREE.Vector3>();
    anchorIndices.forEach(anchorIndex => {
        const anchorPos = handlePositions.get(anchorIndex);
        if(anchorPos) {
            allConstraints.set(anchorIndex, anchorPos);
        }
    });
    
    // 添加所有拖拽点的位置，并更新当前正在拖拽的点
    handleIndices.forEach(handleIndex => {
        // 如果是正在拖拽的点，使用最新的鼠标位置
        if (handleIndex === draggedIndex) {
            allConstraints.set(handleIndex, draggedPos);
        } else {
            // 对于其他未拖拽的 handle，使用它们当前的位置
            const handlePos = handlePositions.get(handleIndex);
            if (handlePos) {
                allConstraints.set(handleIndex, handlePos);
            }
        }
    });

    // 2. 准备提交给 Wasm 的数据
    const indices = new Int32Array(Array.from(allConstraints.keys()));

    // FIX: 将世界坐标转换为局部坐标
    const modelGroup = modelRef.current.getModelGroup();
    if (!modelGroup) {
        console.error("[runDeformation] Impossible d'obtenir le groupe du modèle pour la conversion de coordonnées.");
        animationFrameId.current = null;
        return;
    }

    const positionsLocal = Array.from(allConstraints.values()).map(worldPos => {
        return modelGroup.worldToLocal(worldPos.clone());
    });

    const positions = new Float32Array(positionsLocal.flatMap(p => [p.x, p.y, p.z]));
    console.log('[runDeformation] Préparation des données pour Wasm :', { indices, positions });

    // 在调用 WasmSolverService.setHandles 之前
  console.log('--- FINAL JS VALIDATION ---');
  console.log('Indices to Wasm:', indices);
  console.log('Positions to Wasm:', positions);

  // 添加一个辅助函数检查数组
  const containsInvalidNumbers = (arr: Float32Array | Int32Array) => {
      for (let i = 0; i < arr.length; i++) {
          if (isNaN(arr[i]) || !isFinite(arr[i])) {
              return true;
          }
      }
      return false;
  };

  if (containsInvalidNumbers(indices) || containsInvalidNumbers(positions)) {
      console.error('FATAL: Invalid numbers (NaN or Infinity) detected in data being sent to WASM!');
      // 在这里可以停止执行，防止WASM崩溃
      return; 
  }

    // b. FIX: 调用Wasm求解器 (使用正确的 camelCase 方法名)
    console.log('[runDeformation] Appel du solveur Wasm...');
    WasmSolverService.setHandles(indices, positions);
    WasmSolverService.solve(50);
    const newAllVertices = WasmSolverService.getVertices();

    if (newAllVertices) {
      // c. 更新Three.js模型的几何体
      modelRef.current.updateVertices(newAllVertices);

      // d. FIX: 同步所有控制点（拖拽点和锚点）小球的位置
      const newAllConstraintPositionsWorld = new Map<number, THREE.Vector3>();
      
      // 获取所有约束点的索引（合并 handle 和 anchor）
      const allConstraintIndices = [...handleIndices, ...anchorIndices];

      allConstraintIndices.forEach(constraintIndex => {
          const i = constraintIndex * 3;
          // Wasm 返回的是局部坐标，需要转换回世界坐标来更新 state
          const localPos = new THREE.Vector3(newAllVertices[i], newAllVertices[i+1], newAllVertices[i+2]);
          // 使用 modelGroup 将局部坐标转换回世界坐标
          const worldPos = modelGroup.localToWorld(localPos.clone());
          newAllConstraintPositionsWorld.set(constraintIndex, worldPos);
      });

      // 使用包含所有约束点（锚点和拖拽点）的新位置来更新 handlePositions
      setHandlePositions(newAllConstraintPositionsWorld);

    } else {
        console.error('[runDeformation] Le solveur Wasm n\'a renvoyé aucun sommet.');
    }

    animationFrameId.current = null;
  };

  const handleMove = (draggedIndex: number, newPosition: THREE.Vector3) => {
    // 存储最新的拖拽信息
    console.log(`[App] handleMove a été appelé pour l'index : ${draggedIndex}. Planification de la frame de déformation.`);
    latestDragInfo.current = { index: draggedIndex, pos: newPosition };

    // 如果当前没有正在等待执行的渲染帧，则请求一个新的
    if (!animationFrameId.current) {
      animationFrameId.current = requestAnimationFrame(runDeformation);
    }
  };

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider width={260} style={{ background: '#fff', padding: '24px 16px 0 16px', boxShadow: '2px 0 8px #f0f1f2' }}>
        <Title level={4} style={{ marginBottom: 24 }}>ARAP-Deformer</Title>
        <Button type="primary" icon={<UploadOutlined />} block style={{ marginBottom: 24 }}>
          上传模型
        </Button>
        <Collapse defaultActiveKey={['1']} ghost>
          <Panel header="模式选择" key="1">
            <Radio.Group
              value={mode}
              onChange={e => setMode(e.target.value)}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <Radio value="view">观察模式</Radio>
              <Radio value="select">选择模式</Radio>
              <Radio value="deform">变形模式</Radio>
            </Radio.Group>
            {/* 添加一个清空按钮 */}
            {mode === 'select' && handleIndices.length > 0 && (
                <Button onClick={clearSelection} style={{marginTop: 12}} block>
                  清空选择
              </Button>
            )}
          </Panel>
        </Collapse>
      </Sider>
       <Layout>
        <Content style={{ height: '100vh', background: '#f5f6fa', padding: 0, position: 'relative' }}>
          {/* 6. 添加加载和错误状态的UI提示 */}
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
              
              {/* ADDED: 添加回 TransformControls 组件 */}
              {transformTarget && (
                <TransformControls
                  size={1.6}
                  ref={transformControlsRef}
                  object={transformTarget}
                  mode="rotate"
                  enabled={mode === 'view'} // 只在观察模式下启用
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
              
              {/* MODIFIED: OrbitControls 的 enabled 属性由 state 控制 */}
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