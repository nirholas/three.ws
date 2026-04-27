import * as THREE from "three";
import { TransformControls, useGLTF } from "@react-three/drei";
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CCDIKSolver } from "three/addons/animation/CCDIKSolver.js";
// import { TransformControls } from "three/addons/controls/TransformControls.js";

export default function IKCharacterModel(props) {
  const { scene, camera, gl } = useThree();
  const { nodes, materials } = useGLTF("/QuadShell.glb");
  materials["MI_Enemies.001"].side = THREE.FrontSide;
  materials["MI_Enemies.001"].metalness = 0.3;
  // console.log(nodes, nodes.QuadShell_Body.skeleton.bones);

  const modelRef = useRef(null);
  const FLTargetMesh = useRef(null);
  const FLTargetPos = useRef(new THREE.Vector3());
  const FLIKSolver = useRef(null);
  const yAxis = new THREE.Vector3(0, 1, 0).normalize();
  useEffect(() => {
    // const controls = new TransformControls(camera, gl.domElement);
    /**
     * Prepare IK target meshs
     */
    FLTargetMesh.current = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.1),
      new THREE.MeshBasicMaterial({
        color: "red",
        transparent: true,
        opacity: 0.5,
      })
    );
    FLTargetMesh.current.position.y = -1;
    scene.add(FLTargetMesh.current);

    /**
     * Prepare IK Solvers
     */
    const FLEffectBone = new THREE.Bone();
    FLEffectBone.name = "FLEffectBone";
    nodes["Front_Leg3L"].add(FLEffectBone);

    const newBones = [...nodes.QuadShell_Body.skeleton.bones, FLEffectBone];
    nodes.QuadShell_Body.skeleton = new THREE.Skeleton(newBones);

    console.log(nodes, nodes.QuadShell_Body.skeleton.bones);

    // yAxis.applyMatrix4(nodes["Front_Leg1L"].matrixWorld);
    nodes["Front_Leg1L"].localToWorld(yAxis);
    const FLIKs = [
      {
        target: 1,
        effector: 28,
        links: [
          {
            index: 10,
            rotationMin: new THREE.Vector3(
              -0.7061575303622305,
              -0.33937719547011963,
              -1.7997365542760573
            ),
            rotationMax: new THREE.Vector3(
              -0.7061575303622305,
              -0.33937719547011963,
              -1.7997365542760573
            ),
          },
          {
            index: 9,
            rotationMin: new THREE.Vector3(
              -0.47618080730088014,
              0.665500219808838,
              1.8443565858086026
            ),
            rotationMax: new THREE.Vector3(
              -0.47618080730088014,
              0.665500219808838,
              1.8443565858086026
            ),
          },
          {
            index: 8,
            rotationMin: new THREE.Vector3(
              -0.7428234142105121,
              -0.3149001734994654,
              -1.5731907458251122
            ).addScaledVector(yAxis, -0.5),
            rotationMax: new THREE.Vector3(
              -0.7428234142105121,
              -0.3149001734994654,
              -1.5731907458251122
            ).addScaledVector(yAxis, 0.5),
          },
        ],
      },
    ];
    FLIKSolver.current = new CCDIKSolver(nodes.QuadShell_Body, FLIKs);
  }, [nodes]);

  let time = 0;
  useFrame(() => {
    time += 0.05;
    if (FLTargetMesh.current) {
      FLTargetMesh.current.position.z = 4 * Math.sin(time);
      FLTargetPos.current.copy(FLTargetMesh.current.position);
      modelRef.current.worldToLocal(FLTargetPos.current);
      nodes.Root.children[0].position.copy(FLTargetPos.current);
    }
    FLIKSolver.current?.update();
  });

  return (
    <group
      ref={modelRef}
      {...props}
      dispose={null}
      position={[0, -0.7, 0]}
      scale={0.7}
    >
      <skinnedMesh
        castShadow
        receiveShadow
        name="QuadShell_Body"
        geometry={nodes.QuadShell_Body.geometry}
        material={materials["MI_Enemies.001"]}
        skeleton={nodes.QuadShell_Body.skeleton}
      />
      <skinnedMesh
        castShadow
        receiveShadow
        name="QuadShell_Legs"
        geometry={nodes.QuadShell_Legs.geometry}
        material={materials["MI_Enemies.001"]}
        skeleton={nodes.QuadShell_Legs.skeleton}
      />
      <primitive object={nodes.Root} />
      <primitive object={nodes.Front_Leg_PTL} />
      <primitive object={nodes.Body} />
      <primitive object={nodes.Back_Leg_PTL} />
      <primitive object={nodes.Front_Leg_PTR} />
      <primitive object={nodes.Back_Leg_PTR} />

      {/* <TransformControls object={FLTargetMesh.current}/> */}
    </group>
  );
}

useGLTF.preload("/QuadShell.glb");
