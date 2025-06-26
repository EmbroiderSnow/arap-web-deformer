import { useEffect, useRef, useState, useCallback } from 'react'; // 导入 useCallback
import { forwardRef, useImperativeHandle } from 'react';
import { Canvas, useLoader, useFrame, useThree } from '@react-three/fiber';
import { Environment, TransformControls, OrbitControls } from '@react-three/drei';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import './App.css';
import * as THREE from 'three';

import { Layout, Button, Collapse, Radio, Typography } from 'antd';
import { UploadOutlined } from '@ant-design/icons';

const { Sider, Content } = Layout;
const { Panel } = Collapse;
const { Title } = Typography;

// 将模型加载和处理逻辑封装在一个单独的组件中
const Model = forwardRef(
  function Model(
    { modelScale = 1, mode, selectedPoints, setSelectedPoints }: any,
    ref: React.Ref<any>
  ) {
    const obj = useLoader(OBJLoader, '/model.obj');
    const groupRef = useRef<THREE.Group>(null);
    const { camera, scene } = useThree(); // 获取 scene 实例

    // 使用 state 来存储计算出的初始缩放比例
    // 初始值为 0，这样在计算完成前模型不会显示
    const [initialScale, setInitialScale] = useState(0);

    useEffect(() => {
      if (obj) {
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            if (!child.material) {
              child.material = new THREE.MeshStandardMaterial({
                color: 'lightgray',
                roughness: 0.8,
                metalness: 0.1,
              });
            }
            child.geometry.computeVertexNormals();
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
    }, [obj]);

    // useFrame 不再需要用来设置初始缩放
    // 外部传入的 modelScale 道具仍然可以用于动态调整
    // useFrame(() => {
    //   if (groupRef.current) {
    //     groupRef.current.scale.set(modelScale, modelScale, modelScale);
    //   }
    // });
    
    // pickVertex 方法现在需要能够访问到整个场景的 root object
    // 但是通过 groupRef.current.updateMatrixWorld(true) 已经足以更新子树
    // 更彻底的方法是更新整个场景的矩阵World
    const pickVertex = useCallback((normalizedX: number, normalizedY: number) => {
      console.log(`pickVertex called with normalizedX: ${normalizedX}, normalizedY: ${normalizedY}`);
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2(normalizedX, normalizedY);
      raycaster.setFromCamera(mouse, camera);

      // 更激进的全局世界矩阵更新
      // 强制更新整个场景的世界矩阵，以确保所有变换都已应用
      if (scene) { // 确保 scene 存在
          scene.updateMatrixWorld(true);
          console.log("Forced scene.updateMatrixWorld(true) before raycasting.");
      }

      // 射线检测针对 groupRef.current，它包含了 obj
      // groupRef.current 必须存在才能进行射线检测
      if (!groupRef.current) {
        console.warn("groupRef.current is null when attempting raycast.");
        return;
      }
      const intersects = raycaster.intersectObject(groupRef.current!, true);
      console.log("Intersects length:", intersects.length);

      if (intersects.length > 0) {
        const intersect = intersects[0];
        const pointWorldPosition = intersect.point;

        console.log("Intersected object:", intersect.object.name || intersect.object.uuid);
        console.log("Intersect point (World Coords):", pointWorldPosition);
        // console.log("Intersected object World Matrix:", intersect.object.matrixWorld.elements); // 进一步调试，查看被点击对象的matrixWorld

        setSelectedPoints((prev: THREE.Vector3[]) => {
          const isAlreadySelected = prev.some(p => p.equals(pointWorldPosition));
          if (!isAlreadySelected) {
            console.log("Point selected at:", pointWorldPosition.x, pointWorldPosition.y, pointWorldPosition.z);
            return [...prev, pointWorldPosition.clone()];
          }
          return prev;
        });
      }
    }, [camera, scene, setSelectedPoints]); // 依赖 camera 和 scene

    useImperativeHandle(ref, () => ({
      pickVertex: pickVertex,
      getModelGroup: () => groupRef.current
    }));

    // 合并初始缩放和动态缩放
    const finalScale = initialScale * modelScale;

    return (
      // 将所有缩放逻辑应用在父级 group 上
      // 当 initialScale 为 0 时，模型不可见，计算完成后，组件重渲染并应用正确缩放
      <group ref={groupRef} scale={[finalScale, finalScale, finalScale]}>
        {/* 仅当 initialScale 计算完成后再渲染模型，防止闪烁 */}
        {initialScale > 0 && <primitive object={obj} />}
        {selectedPoints.map((worldPos: THREE.Vector3, index: number) => {
          let localPos = worldPos.clone();
          if (groupRef.current) {
            // 将 world 坐标转换为 group 的局部坐标
            // 注意：此时 group 本身有 transform，所以转换是必要的
            groupRef.current.worldToLocal(localPos);
          }
          return (
            <mesh key={index} position={[localPos.x, localPos.y, localPos.z]}>
              {/* 球体的大小也需要考虑最终的缩放，所以这里使用一个相对较小的值 */}
              <sphereGeometry args={[0.25, 16, 16]} />
              <meshStandardMaterial color="red" />
            </mesh>
          );
        })}
      </group>
    );
  }
);

function Scene({ modelScale, mode, selectedPoints, setSelectedPoints, modelRef }: any) {
  const transformControlsEnabled = mode === 'view';
  
  // 1. 使用 state 来统一管理 OrbitControls 的启用状态，默认为 true
  const [isOrbitEnabled, setIsOrbitEnabled] = useState(true);

  const transformControlsRef = useRef<any>(null);
  const [targetObjectForTransform, setTargetObjectForTransform] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    const modelGroup = modelRef.current?.getModelGroup();
    if (modelGroup && !targetObjectForTransform) {
      setTargetObjectForTransform(modelGroup);
      console.log("Set targetObjectForTransform:", modelGroup);
    }
  }, [modelRef, targetObjectForTransform]);

  // 2. 这个 useEffect 现在只负责根据拖拽事件来“更新 state”，而不是直接操作 controls 对象
  useEffect(() => {
    const currentTransformControls = transformControlsRef.current;
    if (currentTransformControls) {
      const handleDraggingChanged = (event: any) => {
        // 当 TransformControls 开始拖拽 (event.value=true) 时，设置 state 为 false
        // 拖拽结束 (event.value=false) 时，设置 state 为 true
        setIsOrbitEnabled(!event.value);
      };
      currentTransformControls.addEventListener('dragging-changed', handleDraggingChanged);
      return () => {
        currentTransformControls.removeEventListener('dragging-changed', handleDraggingChanged);
      };
    }
  }, []); // 依赖项可以为空，因为它只在 transformControlsRef.current 可用时设置一次监听器


  return (
    <>
      {targetObjectForTransform && (
        <TransformControls
          ref={transformControlsRef}
          object={targetObjectForTransform}
          size={1.6}
          mode="rotate"
          showX={true}
          showY={true}
          showZ={true}
          enabled={transformControlsEnabled}
        />
      )}

      <Model
        ref={modelRef}
        modelScale={modelScale}
        mode={mode}
        selectedPoints={selectedPoints}
        setSelectedPoints={setSelectedPoints}
      />

      {/* 3. 将 state 作为唯一的 "enabled" 来源传递给 OrbitControls */}
      <OrbitControls makeDefault enabled={isOrbitEnabled} />
    </>
  );
}

function App() {
  const [modelScale, setModelScale] = useState(1);
  const [mode, setMode] = useState<'view' | 'select' | 'deform'>('view');
  const [selectedPoints, setSelectedPoints] = useState<THREE.Vector3[]>([]);

  const modelRef = useRef<any>(null);

  useEffect(() => {
    console.log('Currently selected points count:', selectedPoints.length);
    selectedPoints.forEach((point, index) => {
      console.log(`Point ${index}:`, point.x, point.y, point.z);
    });
  }, [selectedPoints]);

  const handlePointerDown = (event: any) => {
    console.log("handlePointerDown triggered on Canvas.");

    if (
      mode === 'select' &&
      event.altKey &&
      event.button === 0 // Left mouse button
    ) {
      if (modelRef.current) {
        const canvasElement = event.target as HTMLCanvasElement;
        const rect = canvasElement.getBoundingClientRect();

        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        console.log(`Attempting to pick vertex at NDC: x=${x}, y=${y}`);
        modelRef.current.pickVertex(x, y);
      } else {
        console.log("ModelRef not ready.");
      }
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
          </Panel>
        </Collapse>
      </Sider>
      <Layout>
        <Content style={{ height: '100vh', background: '#f5f6fa', padding: 0 }}>
          <div
            className="App"
            style={{ width: '100%', height: '100vh' }}
          >
            <Canvas
              onPointerDown={handlePointerDown}
            >
              <Environment preset="studio" />
              <directionalLight position={[5, 10, 5]} intensity={1.5} />
              <Scene
                modelScale={modelScale}
                mode={mode}
                selectedPoints={selectedPoints}
                setSelectedPoints={setSelectedPoints}
                modelRef={modelRef}
              />
            </Canvas>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;