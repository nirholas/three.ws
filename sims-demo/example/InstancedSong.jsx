import * as THREE from "three";
import { Clone, Helper, Merged, useGLTF, useHelper } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import { MeshBVHHelper } from "three-mesh-bvh";
import { useEcctrlStore } from "../src/stores/useEcctrlStore";
import { useThree } from "@react-three/fiber";

export default function InstancedSong(props) {
  // Load map model
  const { scene } = useThree();
  const songBuildModel = useGLTF("./SongBuild.glb");
  const instancedMeshRef = useRef();
  const temp = new THREE.Object3D();

  useEffect(() => {
    songBuildModel.materials.GridTexture.side = THREE.FrontSide;
  }, [songBuildModel]);

  // Instance mesh position preset
  const count = 25;
  const scale = 1;
  const spacingX = 20;
  const spacingZ = 20;
  function generateSpiralPositions(count, spacingX, spacingZ) {
    const positions = [];
    let x = 0;
    let z = 0;
    let dx = 1;
    let dz = 0;
    let steps = 1;
    let stepCount = 0;
    let directionChanges = 0;

    positions.push([0, 0, 0]); // First at center

    for (let i = 1; i < count; i++) {
      x += dx;
      z += dz;
      positions.push([x * spacingX, 0, z * spacingZ]);

      stepCount++;
      if (stepCount >= steps) {
        stepCount = 0;
        // Change direction clockwise (right → down → left → up)
        [dx, dz] = [-dz, dx];
        directionChanges++;

        // Every two direction changes, increase step size
        if (directionChanges % 2 === 0) {
          steps++;
        }
      }
    }

    return positions;
  }

  // useHelper(instancedMeshRef, MeshBVHHelper, 20)

  useEffect(() => {
    const spiralPositions = generateSpiralPositions(count, spacingX, spacingZ);

    for (let i = 0; i < count; i++) {
      const pos = spiralPositions[i];
      if (!pos) break;

      temp.position.set(pos[0], -2, pos[2]);
      temp.rotation.set(0, 0, 0); //-Math.PI / 2
      temp.scale.set(scale, scale, scale);
      temp.updateMatrix();

      instancedMeshRef.current.setMatrixAt(i, temp.matrix);
    }

    instancedMeshRef.current.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <group {...props} dispose={null}>
      <instancedMesh
        castShadow
        receiveShadow
        ref={instancedMeshRef}
        args={[
          songBuildModel.nodes.SongBuild.geometry,
          songBuildModel.materials.GridTexture,
          count,
        ]}
      />
    </group>
  );
}

useGLTF.preload("./SongBuild.glb");
