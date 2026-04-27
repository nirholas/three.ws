/*!
 * BVHEcctrl
 * https://github.com/pmndrs/BVHEcctrl
 * (c) 2025 @ErdongChen-Andrew
 * Released under the MIT License.
 */

/**
 * Physics formulas:
 * 1. F = m * a
 * 2. v = d / t     (constant velocity)
 * 3. a = Δv / t
 * 4. d = v0t + 1/2 * a * t^2
 * 5. v = v0 + a * t
 * 6. J = F * Δt
 * 7. Δv = F * Δt / m
 * 8. E = 1/2 * m * v^2
 * 9. F_drag = -kv
 * 
 * Usefull formulas in ecctrl:
 * 1. pos += velocity * delta
 * 2. vel += acceleration * delta
 * 3. Fg = mass * gravity
 * 4. F(spring) = -k(x - x0)
 * 5. F(damping) = -c * v
 * 6. linVel = radius x angVel
 * 7. K < 1 / (Δt)^2    (60Hz => 3600)
 * 8. C < 2 / Δt    (60Hz => 120)
 */

import * as THREE from "three";
import React, { useEffect, useRef, useMemo, type ReactNode, forwardRef, Suspense, useCallback, useImperativeHandle, type ForwardRefExoticComponent, type RefAttributes } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { TransformControls, useKeyboardControls } from "@react-three/drei";
import { clamp } from "three/src/math/MathUtils";
import type { MovementInput, CharacterAnimationStatus, FloatCheckType } from ".";
import { useEcctrlStore } from ".";
import { useJoystickStore } from ".";
import { useAnimationStore } from ".";
import { useButtonStore } from ".";

// const getAzimuthalAngle = (camera: THREE.Camera, upAxis: THREE.Vector3): number => {
//     const viewDir = new THREE.Vector3();
//     const projDir = new THREE.Vector3();
//     const refDir = new THREE.Vector3(); // reference direction on the plane

//     // Step 1: Calculate camera view direction
//     camera.getWorldDirection(viewDir); // points FROM camera TO target

//     // Step 2: Project view direction onto plane orthogonal to upAxis
//     projDir.copy(viewDir).projectOnPlane(upAxis).normalize();

//     // Step 3: Pick a reference direction on the plane (e.g., X axis projected onto the same plane)
//     refDir.set(0, 0, -1).projectOnPlane(upAxis).normalize();

//     // Step 4: Compute angle between refDir and projected viewDir
//     let angle = Math.acos(THREE.MathUtils.clamp(refDir.dot(projDir), -1, 1)); // in radians

//     // Step 5: Determine sign using cross product
//     const cross = new THREE.Vector3().crossVectors(refDir, projDir);
//     if (cross.dot(upAxis) < 0) {
//         angle = -angle;
//     }

//     return angle; // in radians
// }

const BVHEcctrl = forwardRef<BVHEcctrlApi, EcctrlProps>(({
    children,
    debug = false,
    // Character collider props
    colliderCapsuleArgs = [0.3, 0.6, 4, 8],
    // Physics props
    paused = false,
    delay = 1.5,
    gravity = 9.81,
    fallGravityFactor = 4,
    maxFallSpeed = 50,
    mass = 1,
    sleepTimeout = 10,
    slowMotionFactor = 1,
    // Controller props
    turnSpeed = 15,
    maxWalkSpeed = 3,
    maxRunSpeed = 5,
    acceleration = 30,
    deceleration = 20,
    counterAccFactor = 0.5,
    airDragFactor = 0.3,
    jumpVel = 5,
    // Float check props
    floatCheckType = "BOTH",
    maxSlope = 1,
    floatHeight = 0.2,
    floatPullBackHeight = 0.25,
    floatSensorRadius = 0.12,
    floatSpringK = 600, //1600, //320,
    floatDampingC = 28, //60, //24,
    // Collision check props
    collisionCheckIteration = 3,
    // collisionPushBackStrength = 200,
    collisionPushBackVelocity = 3,
    collisionPushBackDamping = 0.1,
    collisionPushBackThreshold = 0.05,
    // Other props
    ...props
}, ref) => {
    /**
     * Initialize setups
     */
    const { camera } = useThree()
    const capsuleRadius = useMemo(() => colliderCapsuleArgs[0], [])
    const capsuleLength = useMemo(() => colliderCapsuleArgs[1], [])
    // Ref for meshes
    // const characterGroupRef = useRef<THREE.Group | null>(null)
    const characterGroupRef = useRef<THREE.Group | null>(null);
    // const characterGroupRef = ref ?? useRef<THREE.Group | null>(null);
    // const characterGroupRef = (ref as RefObject<THREE.Group>) ?? useRef<THREE.Group | null>(null);
    const characterColliderRef = useRef<THREE.Mesh | null>(null);
    const characterModelRef = useRef<THREE.Group | null>(null);
    // Debug indicators meshes
    const debugBbox = useRef<THREE.Mesh | null>(null)
    const debugLineStart = useRef<THREE.Mesh | null>(null)
    const debugLineEnd = useRef<THREE.Mesh | null>(null)
    const debugRaySensorBbox = useRef<THREE.Mesh | null>(null)
    const debugRaySensorStart = useRef<THREE.Mesh | null>(null)
    const debugRaySensorEnd = useRef<THREE.Mesh | null>(null)
    const standPointRef = useRef<THREE.Mesh | null>(null)
    const lookDirRef = useRef<THREE.Mesh | null>(null)
    const inputDirRef = useRef<THREE.ArrowHelper | null>(null)
    const moveDirRef = useRef<THREE.ArrowHelper | null>(null)

    /**
     * Check if inside keyboardcontrols
     */
    function useIsInsideKeyboardControls() {
        try {
            return !!useKeyboardControls()
        } catch {
            return false
        }
    }
    const isInsideKeyboardControls = useIsInsideKeyboardControls();

    /**
     * keyboard controls setup
     */
    const [subscribeKeys, getKeys] = isInsideKeyboardControls ? useKeyboardControls() : [null];
    const presetKeys = { forward: false, backward: false, leftward: false, rightward: false, jump: false, run: false };

    /**
     * Keyboard controls subscribe setup
     */
    // If inside keyboardcontrols, active subscribeKeys
    // if (isInsideKeyboardControls && subscribeKeys) {
    //     useEffect(() => {
    //         // Jump key subscribe for special animation
    //         const unSubscribeJump = subscribeKeys(
    //             (state) => state.jump,
    //             (value) => {
    //                 if (value && isOnGround.current) currentLinVel.current.y = jumpVel
    //             }
    //         );

    //         return () => {
    //             unSubscribeJump();
    //         };
    //     });
    // }

    /**
     * Subscribe to joystick store changes
     * Update joystick state when joystickX/Y changes
     */
    useEffect(() => {
        const unsubscribeJoystick = useJoystickStore.subscribe(({ joystickX, joystickY }) => joystickState.current.set(joystickX, joystickY));
        return unsubscribeJoystick;
    }, []);

    /**
     * Physics preset
     */
    // const upAxis = useMemo(() => new THREE.Vector3(0, 1, 0), [])
    const upAxis = useRef<THREE.Vector3>(new THREE.Vector3(0, 1, 0))
    const localUpAxis = useRef<THREE.Vector3>(new THREE.Vector3())
    const gravityDir = useRef<THREE.Vector3>(new THREE.Vector3(0, -1, 0))
    const currentLinVel = useRef<THREE.Vector3>(new THREE.Vector3())
    const currVelOnInputDir = useRef<THREE.Vector3>(new THREE.Vector3())
    const currVelOnOtherDir = useRef<THREE.Vector3>(new THREE.Vector3())
    const currentLinVelOnPlane = useRef<THREE.Vector3>(new THREE.Vector3())
    const isFalling = useRef<boolean>(false)

    /**
     * Sleep character preset
     */
    const idleTime = useRef<number>(0);
    const isSleeping = useRef<boolean>(false);

    /**
     * Follow camera prest
     */
    // const camViewDir = useRef<THREE.Vector3>(new THREE.Vector3())
    const camProjDir = useRef<THREE.Vector3>(new THREE.Vector3())
    const camRightDir = useRef<THREE.Vector3>(new THREE.Vector3())
    // const camRefDir = useRef<THREE.Vector3>(new THREE.Vector3())
    // const crossVec = useRef<THREE.Vector3>(new THREE.Vector3())
    // const constRefDir = useMemo<THREE.Vector3>(() => {
    //     camera.updateMatrixWorld(true);
    //     return camera.getWorldDirection(new THREE.Vector3())
    // }, [])

    /**
     * Controls preset
     */
    const inputDir = useRef<THREE.Vector3>(new THREE.Vector3())
    const inputDirOnPlane = useRef<THREE.Vector3>(new THREE.Vector3())
    const movingDir = useRef<THREE.Vector3>(new THREE.Vector3())
    const deltaLinVel = useRef<THREE.Vector3>(new THREE.Vector3())
    const counterVel = useRef<THREE.Vector3>(new THREE.Vector3())
    const wantToMoveVel = useRef<THREE.Vector3>(new THREE.Vector3())
    const forwardState = useRef<boolean>(false)
    const backwardState = useRef<boolean>(false)
    const leftwardState = useRef<boolean>(false)
    const rightwardState = useRef<boolean>(false)
    const joystickState = useRef<THREE.Vector2>(new THREE.Vector2())
    const runState = useRef<boolean>(false)
    const jumpState = useRef<boolean>(false)
    const isOnGround = useRef<boolean>(false)
    const prevIsOnGround = useRef<boolean>(false)
    const prevAnimation = useRef<CharacterAnimationStatus>("IDLE");
    const characterModelTargetQuat = useRef<THREE.Quaternion>(new THREE.Quaternion())
    const characterModelLookMatrix = useRef<THREE.Matrix4>(new THREE.Matrix4())
    const characterOrigin = useMemo(() => new THREE.Vector3(0, 0, 0), [])
    // const characterXAxis = useMemo(() => new THREE.Vector3(1, 0, 0), [])
    // const characterYAxis = useMemo(() => new THREE.Vector3(0, 1, 0), [])
    // const characterZAxis = useMemo(() => new THREE.Vector3(0, 0, 1), [])

    /**
     * Collision preset
     */
    const contactDepth = useRef<number>(0)
    const contactNormal = useRef<THREE.Vector3>(new THREE.Vector3())
    const triContactPoint = useRef<THREE.Vector3>(new THREE.Vector3())
    const capsuleContactPoint = useRef<THREE.Vector3>(new THREE.Vector3())
    const totalDepth = useRef<number>(0);
    const triangleCount = useRef<number>(0);
    const accumulatedContactNormal = useRef<THREE.Vector3>(new THREE.Vector3())
    const accumulatedContactPoint = useRef<THREE.Vector3>(new THREE.Vector3())
    const absorbVel = useRef<THREE.Vector3>(new THREE.Vector3())
    // const pushBackAcc = useRef<THREE.Vector3>(new THREE.Vector3())
    const pushBackVel = useRef<THREE.Vector3>(new THREE.Vector3())
    // Mutable character collision objects
    const characterBbox = useRef<THREE.Box3>(new THREE.Box3())
    // const characterBboxSize = useRef<THREE.Vector3>(new THREE.Vector3())
    // const characterBboxCenter = useRef<THREE.Vector3>(new THREE.Vector3())
    const characterSegment = useRef<THREE.Line3>(new THREE.Line3())
    const localCharacterBbox = useRef<THREE.Box3>(new THREE.Box3())
    const localCharacterSegment = useRef<THREE.Line3>(new THREE.Line3())
    const collideInvertMatrix = useRef<THREE.Matrix4>(new THREE.Matrix4())
    // const collideNormalMatrix = useRef<THREE.Matrix3>(new THREE.Matrix3())
    const relativeCollideVel = useRef<THREE.Vector3>(new THREE.Vector3())
    const relativeContactPoint = useRef<THREE.Vector3>(new THREE.Vector3())
    const contactPointRotationalVel = useRef<THREE.Vector3>(new THREE.Vector3())
    const platformVelocityAtContactPoint = useRef<THREE.Vector3>(new THREE.Vector3())
    //
    const instancedContactMatrix = useRef<THREE.Matrix4>(new THREE.Matrix4())
    const contactTempPos = useRef<THREE.Vector3>(new THREE.Vector3())
    const contactTempQuat = useRef<THREE.Quaternion>(new THREE.Quaternion())
    const contactTempScale = useRef<THREE.Vector3>(new THREE.Vector3())
    const scaledContactRadiusVec = useRef<THREE.Vector3>(new THREE.Vector3())
    const deltaDist = useRef<THREE.Vector3>(new THREE.Vector3())

    /**
     * Floating sensor preset
     */
    const currSlopeAngle = useRef<number>(0)
    // const isOverMaxSlope = useRef<boolean>(false)
    // const isOverSteepSlope = useRef<boolean>(false)
    const localMinDistance = useRef<number>(Infinity)
    const localClosestPoint = useRef<THREE.Vector3>(new THREE.Vector3())
    const localHitNormal = useRef<THREE.Vector3>(new THREE.Vector3())
    const triNormal = useRef<THREE.Vector3>(new THREE.Vector3())
    const globalMinDistance = useRef<number>(Infinity)
    const globalClosestPoint = useRef<THREE.Vector3>(new THREE.Vector3())
    const triHitPoint = useRef<THREE.Vector3>(new THREE.Vector3())
    const segHitPoint = useRef<THREE.Vector3>(new THREE.Vector3())
    const floatHitVec = useRef<THREE.Vector3>(new THREE.Vector3())
    const floatHitNormal = useRef<THREE.Vector3>(new THREE.Vector3())
    const floatHitMesh = useRef<THREE.Object3D | THREE.Mesh | null>(null)
    const groundFriction = useRef<number>(0.8)
    // const closestPointHorizontalDis = useRef<THREE.Vector3>(new THREE.Vector3())
    // const closestPointVerticalDis = useRef<THREE.Vector3>(new THREE.Vector3())
    // const steepSlopeThreshold = useMemo(() => Math.atan((capsuleRadius + floatHeight + floatPullBackHeight + floatSensorRadius) / (capsuleRadius - floatSensorRadius)), [])
    // Mutable float sensor objects
    const floatSensorBbox = useRef<THREE.Box3>(new THREE.Box3())
    // const floatSensorBboxSize = useRef<THREE.Vector3>(new THREE.Vector3())
    // const floatSensorBboxCenter = useRef<THREE.Vector3>(new THREE.Vector3())
    const floatSensorBboxExpendPoint = useRef<THREE.Vector3>(new THREE.Vector3())
    const floatSensorSegment = useRef<THREE.Line3>(new THREE.Line3())
    const localFloatSensorBbox = useRef<THREE.Box3>(new THREE.Box3())
    const localFloatSensorBboxExpendPoint = useRef<THREE.Vector3>(new THREE.Vector3())
    const localFloatSensorSegment = useRef<THREE.Line3>(new THREE.Line3())
    const floatInvertMatrix = useRef<THREE.Matrix4>(new THREE.Matrix4())
    const floatNormalInverseMatrix = useRef<THREE.Matrix3>(new THREE.Matrix3())
    const floatNormalMatrix = useRef<THREE.Matrix3>(new THREE.Matrix3())
    const floatRaycaster = useRef<THREE.Raycaster>(new THREE.Raycaster())
    floatRaycaster.current.far = capsuleRadius + floatHeight + floatPullBackHeight
    const relativeHitPoint = useRef<THREE.Vector3>(new THREE.Vector3())
    const rotationDeltaPos = useRef<THREE.Vector3>(new THREE.Vector3())
    const yawQuaternion = useRef<THREE.Quaternion>(new THREE.Quaternion())
    const totalPlatformDeltaPos = useRef<THREE.Vector3>(new THREE.Vector3())
    const isOnMovingPlatform = useRef<boolean>(false)
    const instancedHitMatrix = useRef<THREE.Matrix4>(new THREE.Matrix4())
    const floatTempPos = useRef<THREE.Vector3>(new THREE.Vector3())
    const floatTempQuat = useRef<THREE.Quaternion>(new THREE.Quaternion())
    const floatTempScale = useRef<THREE.Vector3>(new THREE.Vector3())
    const scaledFloatRadiusVec = useRef<THREE.Vector3>(new THREE.Vector3())
    const deltaHit = useRef<THREE.Vector3>(new THREE.Vector3())

    /**
     * Global store values
     * Getting all collider array from store
     */
    const colliderMeshesArray = useEcctrlStore.getState().colliderMeshesArray;
    // Fitler meshes array for raycasting collision
    const floatRaycastCandidates = useMemo(() => colliderMeshesArray.filter((mesh) => mesh.geometry.boundsTree && !(mesh instanceof THREE.InstancedMesh)), [colliderMeshesArray]);

    /**
     * Gravity funtion
     */
    const applyGravity = useCallback((delta: number) => {
        gravityDir.current.copy(upAxis.current).negate()
        const fallingSpeed = currentLinVel.current.dot(gravityDir.current)
        isFalling.current = fallingSpeed > 0
        if (fallingSpeed < maxFallSpeed) {
            currentLinVel.current.addScaledVector(gravityDir.current, gravity * (isFalling.current ? fallGravityFactor : 1) * delta)
        }
    }, [gravity, fallGravityFactor, maxFallSpeed])

    /**
     * Check if need to sleep character function
     */
    const checkCharacterSleep = useCallback((jump: boolean, delta: number) => {
        const moving = currentLinVel.current.lengthSq() > 1e-6;
        const platformIsMoving = totalPlatformDeltaPos.current.lengthSq() > 1e-6;

        if (!moving && isOnGround.current && !jump && !isOnMovingPlatform.current && !platformIsMoving) {
            idleTime.current += delta;
            if (idleTime.current > sleepTimeout) isSleeping.current = true;
        } else {
            idleTime.current = 0;
            isSleeping.current = false;
        }
    }, [])

    /**
     * Get camera azimuthal angle funtion
     */
    // const getAzimuthalAngle = useCallback((camera: THREE.Camera, upAxis: THREE.Vector3): number => {
    //     camera.getWorldDirection(camViewDir.current);
    //     camProjDir.current.copy(camViewDir.current).projectOnPlane(upAxis).normalize();
    //     camRefDir.current.copy(constRefDir).projectOnPlane(upAxis).normalize();
    //     let angle = Math.acos(clamp(camRefDir.current.dot(camProjDir.current), -1, 1));
    //     crossVec.current.crossVectors(camRefDir.current, camProjDir.current);
    //     if (crossVec.current.dot(upAxis) < 0) angle = -angle;
    //     return angle;
    // }, [])

    /**
     * Get input direction function
     * Getting Character moving direction from user inputs
     */
    const setInputDirection = useCallback((dir: {
        forward?: boolean;
        backward?: boolean;
        leftward?: boolean;
        rightward?: boolean;
        joystick?: THREE.Vector2;
    }) => {
        // Reset inputDir.current
        inputDir.current.set(0, 0, 0)

        // Retrieve camera project/right direction
        camera.getWorldDirection(camProjDir.current);
        camProjDir.current.projectOnPlane(upAxis.current).normalize();
        camRightDir.current.crossVectors(camProjDir.current, upAxis.current).normalize()

        // Handle joystick analog input (if available)
        if (dir.joystick && dir.joystick.lengthSq() > 0) {
            inputDir.current
                .addScaledVector(camProjDir.current, dir.joystick.y)
                .addScaledVector(camRightDir.current, dir.joystick.x)
        } else {
            // Handle digital input
            if (dir.forward) inputDir.current.add(camProjDir.current)
            if (dir.backward) inputDir.current.sub(camProjDir.current)
            if (dir.leftward) inputDir.current.sub(camRightDir.current)
            if (dir.rightward) inputDir.current.add(camRightDir.current)
        }

        // Apply camera forward/right direction to moving direction
        // if (forward) inputDir.current.add(camProjDir.current)
        // if (backward) inputDir.current.sub(camProjDir.current)
        // if (leftward) inputDir.current.sub(camRightDir.current)
        // if (rightward) inputDir.current.add(camRightDir.current)

        // Rotate inputDir according to camera azimuthal angle
        // inputDir.current.applyAxisAngle(upAxis, camAngle);

        // Apply slope up/down angle to inputDir if slope is less then max angle
        // if (!isOverMaxSlope.current) inputDir.current.projectOnPlane(floatHitNormal.current)

        inputDir.current.normalize()
    }, [])

    /**
     * Handle character movement function
     */
    const handleCharacterMovement = useCallback((runState: boolean, delta: number) => {
        // Get and clamp groundFriction to a reasonable number
        const friction = clamp(groundFriction.current, 0, 1)

        // Check if there is a user input to move character
        if (inputDir.current.lengthSq() > 0) {
            /**
             * Rotate character model to input direction
             */
            if (characterModelRef.current) {
                // Build look at rotation matrix from inout direction and up axis
                inputDirOnPlane.current.copy(inputDir.current).projectOnPlane(upAxis.current)
                characterModelLookMatrix.current.lookAt(inputDirOnPlane.current, characterOrigin, upAxis.current);
                // Convert matrix to quaternion
                characterModelTargetQuat.current.setFromRotationMatrix(characterModelLookMatrix.current);
                // Slerp current model rotation toward target
                characterModelRef.current.quaternion.slerp(characterModelTargetQuat.current, delta * turnSpeed);
            }

            /**
             * Compute character moving velocity to input direction
             */
            // Find character desired target velocity and direction
            const maxSpeed = runState ? maxRunSpeed : maxWalkSpeed
            wantToMoveVel.current.copy(inputDir.current).multiplyScalar(maxSpeed)

            // If currently moving in oppsite direction then wantToMoveVel
            // Consider adding counter velocity to wantToMoveVel to improve control feels            
            const dot = movingDir.current.dot(inputDir.current)
            // if (dot < 0) {
            //     counterVel.current.copy(currentLinVelOnPlane.current).multiplyScalar(dot * 10)
            //     // // counterVel.current.clampLength(0, maxRunSpeed * counterVelFactor) // prevent overshoot
            //     wantToMoveVel.current.add(counterVel.current)
            // }

            // According to this formula: Δv = a * Δt
            // Find Δv which increase currentLinVel in every frame, until reach wantToMoveVel
            deltaLinVel.current.subVectors(wantToMoveVel.current, currentLinVelOnPlane.current)
            deltaLinVel.current.clampLength(0, (dot <= 0 ? 1 + counterAccFactor : 1) * acceleration * friction * delta * (isOnGround.current ? 1 : airDragFactor))

            // Add Δv to currentLinVel
            // Consider adding slope effect to velocity
            // isOnGround.current ? currentLinVel.current.add(deltaLinVel.current) : currentLinVel.current.add(deltaLinVel.current.projectOnPlane(upAxis.current))
            currentLinVel.current.add(deltaLinVel.current)
        } else if (isOnGround.current) {
            // If no user inputs & is on ground, apply friction drag
            deltaLinVel.current.copy(currentLinVelOnPlane.current).clampLength(0, deceleration * friction * delta)
            currentLinVel.current.sub(deltaLinVel.current)
        }
    }, [acceleration, deceleration, airDragFactor, counterAccFactor, maxRunSpeed, maxWalkSpeed, turnSpeed])
    /**
     * Back-up handleCharacterMovement
     */
    // const handleCharacterMovement = useCallback((runState: boolean, delta: number) => {
    //     // Get and clamp groundFriction to a reasonable number
    //     const friction = clamp(groundFriction.current, 0, 1)

    //     // Check if there is a user input to move character
    //     if (inputDir.current.lengthSq() > 0) {
    //         // Turn character model to input direction
    //         if (characterModelRef.current) {
    //             // Build look at rotation matrix from inout direction and up axis
    //             inputDirOnPlane.current.copy(inputDir.current).projectOnPlane(upAxis.current)
    //             characterModelLookMatrix.current.lookAt(inputDirOnPlane.current, characterOrigin, upAxis.current);
    //             // Convert matrix to quaternion
    //             characterModelTargetQuat.current.setFromRotationMatrix(characterModelLookMatrix.current);
    //             // Slerp current model rotation toward target
    //             characterModelRef.current.quaternion.slerp(characterModelTargetQuat.current, delta * turnSpeed);
    //         }

    //         // Find character desired target velocity and direction
    //         wantToMoveVel.current.copy(inputDir.current).multiplyScalar(runState ? maxRunSpeed : maxWalkSpeed)

    //         // If currently moving in oppsite direction then wantToMoveVel
    //         // Consider adding counter velocity to wantToMoveVel to improve control feels
    //         const dot = clamp(movingDir.current.dot(inputDir.current), -1, 0)
    //         if (dot < -0.5) {
    //             counterVel.current.copy(currentLinVel.current).multiplyScalar(dot * counterVelFactor * friction).projectOnPlane(floatHitNormal.current)
    //             // counterVel.current.clampLength(0, maxRunSpeed * counterVelFactor) // prevent overshoot
    //             wantToMoveVel.current.add(counterVel.current)
    //         }

    //         // According to this formula: Δv = a * Δt
    //         // Find Δv which increase currentLinVel in every frame, until reach wantToMoveVel
    //         deltaLinVel.current.subVectors(wantToMoveVel.current, currentLinVel.current)
    //         deltaLinVel.current.clampLength(0, acceleration * friction * delta * (isOnGround.current ? 1 : airDragFactor))

    //         // Add Δv to currentLinVel
    //         // Consider adding slope effect to velocity
    //         // isOnGround.current ? currentLinVel.current.add(deltaLinVel.current) : currentLinVel.current.add(deltaLinVel.current.projectOnPlane(upAxis.current))
    //         currentLinVel.current.add(deltaLinVel.current.projectOnPlane(upAxis.current))
    //     } else if (isOnGround.current) {
    //         // If no user inputs & is on ground, apply friction drag to currentLinVelOnPlane
    //         currentLinVelOnPlane.current.copy(currentLinVel.current).projectOnPlane(upAxis.current).multiplyScalar(deceleration * friction * delta)
    //         currentLinVel.current.sub(currentLinVelOnPlane.current)
    //         // currentLinVel.current.multiplyScalar(1 - deceleration * friction * delta);
    //     }
    // }, [acceleration, deceleration, airDragFactor, counterVelFactor, maxRunSpeed, maxWalkSpeed, turnSpeed])

    /**
     * Update character and float senenor segment/bbox function (world space)
     */
    const updateSegmentBBox = useCallback(() => {
        // Exit if characterGroupRef is not ready
        if (!characterGroupRef.current) return

        // Update character capsule segment
        characterSegment.current.start.set(0, capsuleLength / 2, 0).add(characterGroupRef.current.position)
        characterSegment.current.end.set(0, -capsuleLength / 2, 0).add(characterGroupRef.current.position)

        // Update character bounding box
        characterBbox.current
            .makeEmpty()
            .expandByPoint(characterSegment.current.start)
            .expandByPoint(characterSegment.current.end)
            .expandByScalar(capsuleRadius)

        // Update float sensor segment
        floatSensorSegment.current.start.copy(characterSegment.current.end)
        floatSensorSegment.current.end.copy(floatSensorSegment.current.start).addScaledVector(gravityDir.current, floatHeight + capsuleRadius)
        floatSensorBboxExpendPoint.current.copy(floatSensorSegment.current.end).addScaledVector(gravityDir.current, floatPullBackHeight)

        // Update float sensor bounding box
        floatSensorBbox.current
            .makeEmpty()
            .expandByPoint(floatSensorSegment.current.start)
            .expandByPoint(floatSensorBboxExpendPoint.current)
            .expandByScalar(floatSensorRadius)
    }, [capsuleRadius, capsuleLength, floatHeight, floatPullBackHeight, floatSensorRadius])

    /**
     * Collision Check
     * Check if character segment range is collider with map bvh
     * If so, getting contact point depth and direction, then apply to character velocity
     */
    const collisionCheck = useCallback((mesh: THREE.Mesh, originMatrix: THREE.Matrix4, delta: number) => {
        // Early exit if map is not visible and if map geometry boundsTree is not ready
        if (!mesh.visible || !mesh.geometry.boundsTree || mesh.userData.excludeCollisionCheck) return

        // Decompose position/quaternion/scale from originMatrix
        originMatrix.decompose(contactTempPos.current, contactTempQuat.current, contactTempScale.current)

        // Invert the collider matrix from world → local space
        collideInvertMatrix.current.copy(originMatrix).invert();

        /**
         * Convert from world mattrix -> local matrix
         */
        // Copy and transform the segment to local space
        localCharacterSegment.current.copy(characterSegment.current).applyMatrix4(collideInvertMatrix.current);

        // Convert capsule radius value to local scaling (number -> vector3) (unitless)
        scaledContactRadiusVec.current.set(capsuleRadius / contactTempScale.current.x, capsuleRadius / contactTempScale.current.y, capsuleRadius / contactTempScale.current.z)

        // Compute bounding box in local space
        localCharacterBbox.current.makeEmpty().expandByPoint(localCharacterSegment.current.start).expandByPoint(localCharacterSegment.current.end)
        localCharacterBbox.current.min.addScaledVector(scaledContactRadiusVec.current, -1)
        localCharacterBbox.current.max.add(scaledContactRadiusVec.current);

        // Reset contact point info
        contactDepth.current = 0
        contactNormal.current.set(0, 0, 0)
        absorbVel.current.set(0, 0, 0)
        pushBackVel.current.set(0, 0, 0)
        platformVelocityAtContactPoint.current.set(0, 0, 0)
        // Reset accumulated info
        totalDepth.current = 0;
        triangleCount.current = 0;
        accumulatedContactNormal.current.set(0, 0, 0)
        accumulatedContactPoint.current.set(0, 0, 0)

        // Bounds tree conllision check, finding contact normal and depth using localBox & localSegment
        mesh.geometry.boundsTree.shapecast({
            // If not intersects with character bbox, just stop entire shapecast
            intersectsBounds: box => box.intersectsBox(localCharacterBbox.current),
            // If intersects with character bbox, deeply check collision with character segment
            intersectsTriangle: tri => {
                // Find cloest point on tri to character segment
                tri.closestPointToSegment(localCharacterSegment.current, triContactPoint.current, capsuleContactPoint.current);

                // Calculate the difference vector from capsuleContactPoint to triContactPoint
                deltaDist.current.copy(triContactPoint.current).sub(capsuleContactPoint.current)

                // Convert deltaDist to unitless base on scaledRadiusVec,
                // It will be use to determine if there is a collsion happening
                deltaDist.current.divide(scaledContactRadiusVec.current)

                // If scaledDistance is less then 1, means there is a collision happening
                if (deltaDist.current.lengthSq() < 1) {
                    /**
                     * Convert from local mattrix -> world matrix
                     */
                    triContactPoint.current.applyMatrix4(originMatrix)
                    capsuleContactPoint.current.applyMatrix4(originMatrix)

                    // Compute normal and depth in world matrix
                    contactNormal.current.copy(capsuleContactPoint.current).sub(triContactPoint.current).normalize()
                    contactDepth.current = capsuleRadius - capsuleContactPoint.current.distanceTo(triContactPoint.current)

                    // Accumulate weighted normal and contact point in world matrix
                    accumulatedContactNormal.current.addScaledVector(contactNormal.current, contactDepth.current);
                    accumulatedContactPoint.current.add(triContactPoint.current);

                    // Accumulate depth and count
                    totalDepth.current += contactDepth.current;
                    triangleCount.current += 1;
                }
            }
        })

        /**
         * Handle collision event if there is any contact point
         */
        if (triangleCount.current > 0) {
            // Compute average contact point/normal/depth
            accumulatedContactNormal.current.normalize()
            accumulatedContactPoint.current.divideScalar(triangleCount.current)
            const avgDepth = totalDepth.current / triangleCount.current;

            /**
             * Compute relative contact velocity on different type of platforms (STATIC/KINEMATIC)
             */
            // if collide with moving platform, calculate relativeVel with platformVelocity
            // otherwise relativeVel is same as the currentLinVel
            const isStatic = mesh.userData.type === "STATIC";
            const isKinematic = mesh.userData.type === "KINEMATIC";
            const isActive = mesh.userData.active === true;
            if (isStatic) {
                relativeCollideVel.current.copy(currentLinVel.current);
            } else if (isKinematic && !isActive) {
                relativeCollideVel.current.copy(currentLinVel.current);
            } else if (isKinematic && isActive) {
                // Convert angular velocity to linear velocity at the contact point: linVel = radius x angVel
                // relativeContactPoint is the radius of the rotation, contactPointRotationalVel is converted linear velocity
                relativeContactPoint.current.copy(accumulatedContactPoint.current).sub(mesh.userData.center)
                contactPointRotationalVel.current.crossVectors(mesh.userData.angularVelocity, relativeContactPoint.current);
                // Combine linear & angular velocity to form total platform velocity at the triContactPoint
                platformVelocityAtContactPoint.current.copy(mesh.userData.linearVelocity).add(contactPointRotationalVel.current)
                // Now finally compute relative velocity
                relativeCollideVel.current.copy(currentLinVel.current).sub(platformVelocityAtContactPoint.current);
            }

            /**
             * Resolve character collision velocity
             * Absorb velocity at direction into collider, 
             * optionly apply bounce velocity from collider (restitution)
             * If character stuck inside colliders
             * Apply push-back force based on contact depth
             */
            const intoSurfaceVel = relativeCollideVel.current.dot(accumulatedContactNormal.current);

            // Absorb velocity based on restitution
            if (intoSurfaceVel < 0) {
                absorbVel.current.copy(accumulatedContactNormal.current).multiplyScalar(-intoSurfaceVel * (1 + mesh.userData.restitution));
                currentLinVel.current.add(absorbVel.current);
            }

            // Apply push-back if contact depth is above threshold
            if (avgDepth > collisionPushBackThreshold) {
                // characterGroupRef.current.position.addScaledVector(accumulatedContactNormal.current,avgDepth)
                const correction = (collisionPushBackDamping / delta) * avgDepth;
                pushBackVel.current.copy(accumulatedContactNormal.current).multiplyScalar(correction);
                currentLinVel.current.add(pushBackVel.current);
            }
        }
    }, [capsuleRadius, collisionPushBackThreshold, collisionPushBackDamping, collisionPushBackVelocity, debug])

    /**
     * Handle character collision response function
     */
    const handleCollisionResponse = useCallback((colliderMeshesArray: THREE.Mesh[], delta: number) => {
        // Exit if colliderMeshesArray is not ready
        if (colliderMeshesArray.length === 0) return

        // Check collisions multiple times for better precision 
        for (let i = 0; i < collisionCheckIteration; i++) {
            for (const mesh of colliderMeshesArray) {
                if (mesh instanceof THREE.InstancedMesh) {
                    for (let i = 0; i < mesh.count; i++) {
                        // Extract the instance matrix
                        mesh.getMatrixAt(i, instancedContactMatrix.current);
                        collisionCheck(mesh, instancedContactMatrix.current, delta)
                    }
                } else {
                    collisionCheck(mesh, mesh.matrixWorld, delta)
                }
            }
        }
    }, [collisionCheckIteration, collisionCheck]);
    /**
     * Back-up handleCollisionResponse
     */
    // const handleCollisionResponse = useCallback((colliderMeshesArray: THREE.Mesh[], delta: number) => {
    //     // Exit if colliderMeshesArray is not ready
    //     if (colliderMeshesArray.length === 0) return

    //     /**
    //      * Collision Check
    //      * Check if character segment range is collider with map bvh
    //      * If so, getting contact point depth and direction, then apply to character velocity
    //      */
    //     // Check collisions multiple times for better precision 
    //     for (let i = 0; i < collisionCheckIteration; i++) {
    //         for (const mesh of colliderMeshesArray) {
    //             // Early exit if map is not visible and if map geometry boundsTree is not ready
    //             if (!mesh.visible || !mesh.geometry.boundsTree) continue;

    //             // Invert the collider matrix from world → local space
    //             collideInvertMatrix.current.copy(mesh.matrixWorld).invert();
    //             // Get collider matrix normal for later transform local → world space
    //             collideNormalMatrix.current.getNormalMatrix(mesh.matrixWorld)

    //             // Copy and transform the segment to local space
    //             localCharacterSegment.current.copy(characterSegment.current).applyMatrix4(collideInvertMatrix.current)

    //             // Compute bounding box in local space
    //             localCharacterBbox.current
    //                 .makeEmpty()
    //                 .expandByPoint(localCharacterSegment.current.start)
    //                 .expandByPoint(localCharacterSegment.current.end)
    //                 .expandByScalar(capsuleRadius)

    //             // Reset contact point info
    //             contactDepth.current = 0
    //             contactNormal.current.set(0, 0, 0)
    //             absorbVel.current.set(0, 0, 0)
    //             pushBackVel.current.set(0, 0, 0)
    //             platformVelocityAtContactPoint.current.set(0, 0, 0)
    //             // Reset accumulated info
    //             totalDepth.current = 0;
    //             triangleCount.current = 0;
    //             accumulatedContactNormal.current.set(0, 0, 0)
    //             accumulatedContactPoint.current.set(0, 0, 0)

    //             // Bounds tree conllision check, finding contact normal and depth using localBox & localSegment
    //             mesh.geometry.boundsTree.shapecast({
    //                 // If not intersects with character bbox, just stop entire shapecast
    //                 intersectsBounds: box => box.intersectsBox(localCharacterBbox.current),
    //                 // If intersects with character bbox, deeply check collision with character segment
    //                 intersectsTriangle: tri => {
    //                     // Find distance to character segment
    //                     const distance = tri.closestPointToSegment(localCharacterSegment.current, triContactPoint.current, capsuleContactPoint.current);
    //                     // If distance is less then character capsule radius, means there is a collision happening
    //                     if (distance < capsuleRadius) {
    //                         // Calculate collision contact depth and normal
    //                         contactDepth.current = capsuleRadius - distance;
    //                         // Local space contact normal
    //                         contactNormal.current.copy(capsuleContactPoint.current).sub(triContactPoint.current);

    //                         // Accumulate weighted normal and contact point
    //                         accumulatedContactNormal.current.addScaledVector(contactNormal.current.normalize(), contactDepth.current);
    //                         accumulatedContactPoint.current.add(triContactPoint.current);

    //                         // Accumulate depth and count
    //                         totalDepth.current += contactDepth.current;
    //                         triangleCount.current += 1;
    //                     }
    //                 }
    //             })

    //             if (triangleCount.current > 0) {
    //                 // Transform average normal to world space
    //                 accumulatedContactNormal.current.applyMatrix3(collideNormalMatrix.current).normalize();
    //                 // Transform average contact point to world space
    //                 accumulatedContactPoint.current.divideScalar(triangleCount.current).applyMatrix4(mesh.matrixWorld)
    //                 // Compute average contact depth
    //                 const avgDepth = totalDepth.current / triangleCount.current;

    //                 /**
    //                  * For different type of platforms
    //                  */
    //                 // if collide with moving platform, calculate relativeVel with platformVelocity
    //                 // otherwise relativeVel is same as the currentLinVel
    //                 if (mesh.userData.type === "STATIC") {
    //                     relativeCollideVel.current.copy(currentLinVel.current)
    //                 } else if (mesh.userData.type === "KINEMATIC") {
    //                     // Convert angular velocity to linear velocity at the contact point: linVel = radius x angVel
    //                     // relativeContactPoint is the radius of the rotation, contactPointRotationalVel is converted linear velocity
    //                     relativeContactPoint.current.copy(accumulatedContactPoint.current).sub(mesh.userData.center)
    //                     contactPointRotationalVel.current.crossVectors(mesh.userData.angularVelocity, relativeContactPoint.current);
    //                     // Combine linear & angular velocity to form total platform velocity at the triContactPoint
    //                     platformVelocityAtContactPoint.current.copy(mesh.userData.linearVelocity).add(contactPointRotationalVel.current);
    //                     // Now finally compute relative velocity
    //                     relativeCollideVel.current.copy(currentLinVel.current).sub(platformVelocityAtContactPoint.current);
    //                 }

    //                 /**
    //                  * Resolve character collision velocity
    //                  * Absorb velocity at direction into collider, 
    //                  * optionly apply bounce velocity from collider (restitution)
    //                  * If character stuck inside colliders
    //                  * Apply push-back force based on contact depth
    //                  */
    //                 const intoSurfaceVel = relativeCollideVel.current.dot(accumulatedContactNormal.current);

    //                 // Absorb velocity based on restitution
    //                 if (intoSurfaceVel < 0) {
    //                     absorbVel.current.copy(accumulatedContactNormal.current).multiplyScalar(-intoSurfaceVel * (1 + mesh.userData.restitution));
    //                     currentLinVel.current.add(absorbVel.current);
    //                 }

    //                 // Apply push-back if contact depth is above threshold
    //                 if (avgDepth > collisionPushBackThreshold) {
    //                     const correction = (collisionPushBackDamping / delta) * avgDepth;
    //                     pushBackVel.current.copy(accumulatedContactNormal.current).multiplyScalar(correction);
    //                     currentLinVel.current.add(pushBackVel.current);
    //                 }

    //                 /**
    //                  * Debug setup: indicate contact point and direction
    //                  */
    //                 if (debug && contactPointRef.current) {
    //                     // Apply the updated values to contact indicator
    //                     contactPointRef.current.position.copy(accumulatedContactPoint.current)
    //                     contactPointRef.current.lookAt(accumulatedContactNormal.current)
    //                 }
    //             }


    //         }
    //     }
    // }, [collisionCheckIteration, capsuleRadius, collisionPushBackThreshold, collisionPushBackDamping, collisionPushBackVelocity, debug]);

    /**
     * Floating check
     * Check if float sensor hits any point downward
     * If so, Apply sping and damping force to float character up
     * Also apply a small sensor overshoot, which can pull character down when walk over a small ramp
     */
    const floatingCheck = useCallback((mesh: THREE.Mesh, originMatrix: THREE.Matrix4) => {
        // Early exit if map is not visible and if map geometry boundsTree is not ready
        // if (!mesh.visible || !mesh.geometry.boundsTree || mesh.userData.excludeFloatHit) return

        // Decompose position/quaternion/scale from originMatrix
        originMatrix.decompose(floatTempPos.current, floatTempQuat.current, floatTempScale.current)

        // Invert the collider matrix from world → local space
        floatInvertMatrix.current.copy(originMatrix).invert();
        floatNormalInverseMatrix.current.getNormalMatrix(floatInvertMatrix.current);
        // Get collider matrix normal for later transform local → world space
        floatNormalMatrix.current.getNormalMatrix(originMatrix)

        /**
         * Convert from world mattrix -> local matrix
         */
        // Copy and transform the segment to local space
        localFloatSensorSegment.current.copy(floatSensorSegment.current).applyMatrix4(floatInvertMatrix.current);
        localFloatSensorBboxExpendPoint.current.copy(floatSensorBboxExpendPoint.current).applyMatrix4(floatInvertMatrix.current);

        // Convert sensor radius value to local scaling (number -> vector3) (unitless)
        scaledFloatRadiusVec.current.set(floatSensorRadius / floatTempScale.current.x, floatSensorRadius / floatTempScale.current.y, floatSensorRadius / floatTempScale.current.z)

        // Compute bounding box in local space
        localFloatSensorBbox.current.makeEmpty().expandByPoint(localFloatSensorSegment.current.start).expandByPoint(localFloatSensorBboxExpendPoint.current)
        localFloatSensorBbox.current.min.addScaledVector(scaledFloatRadiusVec.current, -1)
        localFloatSensorBbox.current.max.add(scaledFloatRadiusVec.current);

        // Reset float sensor hit point info
        localMinDistance.current = Infinity;
        localClosestPoint.current.set(Infinity, Infinity, Infinity);

        // Check if floating ray hits any map faces, 
        // and find the closest point to sensor start point
        mesh.geometry.boundsTree?.shapecast({
            // If not intersects with float sensor bbox, just stop entire shapecast  
            intersectsBounds: box => box.intersectsBox(localFloatSensorBbox.current),
            // If intersects with float sensor bbox, deeply check collision with float sensor segment
            intersectsTriangle: tri => {
                tri.closestPointToSegment(localFloatSensorSegment.current, triHitPoint.current, segHitPoint.current);

                // Compute up axis in local space
                localUpAxis.current.copy(upAxis.current).applyMatrix3(floatNormalInverseMatrix.current).normalize();

                // Calculate the difference vector from segment start to triHitPoint
                deltaHit.current.subVectors(triHitPoint.current, localFloatSensorSegment.current.start)

                // Convert deltaDist to unitless base on scaledRadiusVec,
                // It will be use to determine if there is a collsion happening
                deltaHit.current.divide(scaledFloatRadiusVec.current)

                // Seperate the hit vector to vertical & horizontal length for hit check (along gravity direction)
                // totalLength^2 = vertical^2 + horizontal^2
                const totalLengthSq = deltaHit.current.lengthSq();
                const dot = deltaHit.current.dot(localUpAxis.current)
                // Get vertical length (unitless, scaled by sensor hit length/radius)
                const verticalLength = Math.abs(dot) / ((capsuleRadius + floatHeight + floatPullBackHeight) / floatSensorRadius);
                // Get horizontal length: √(total² - vertical²)
                const horizontalLength = Math.sqrt(Math.max(0, totalLengthSq - dot * dot));

                // Only accept triangle hit if inside sensor range
                if (horizontalLength < 1 && verticalLength < 1) {
                    // Local space hit tri normal
                    tri.getNormal(triNormal.current);

                    /**
                     * Convert from local mattrix -> world matrix
                     */
                    // Transform normal to world space using normalMatrix
                    triNormal.current.applyMatrix3(floatNormalMatrix.current).normalize();
                    // Transform hit point to world space
                    triHitPoint.current.applyMatrix4(originMatrix);

                    // Compute the current tri slope angle
                    const slopeAngle = triNormal.current.angleTo(upAxis.current);
                    // Store the closest and within max slope point
                    if (verticalLength < localMinDistance.current && slopeAngle < maxSlope) {
                        localMinDistance.current = verticalLength;
                        localClosestPoint.current.copy(triHitPoint.current);
                        localHitNormal.current.copy(triNormal.current);
                    }
                }
            }
        });

        /**
         * bvh.shapecast might hit multiple faces, 
         * and only the closest one return a valid number, 
         * other faces would return infinity.
         * Store only the closest point globalMinDistance/globalClosestPoint
         */
        if (localMinDistance.current < globalMinDistance.current) {
            globalMinDistance.current = localMinDistance.current;
            globalClosestPoint.current.copy(localClosestPoint.current);
            floatHitNormal.current.copy(localHitNormal.current);
            currSlopeAngle.current = floatHitNormal.current.angleTo(upAxis.current);
            groundFriction.current = mesh.userData.friction;
            floatHitMesh.current = mesh;
        }
    }, [floatSensorRadius, capsuleRadius, floatHeight, floatPullBackHeight, maxSlope])

    /**
     * Handle character floating response function
     * Also check if character is on ground
     */
    const handleFloatingResponse = useCallback((colliderMeshesArray: THREE.Mesh[], jump: boolean, delta: number) => {
        // Exit if colliderMeshesArray is not ready
        if (colliderMeshesArray.length === 0) return

        // Reset float sensor hit global info
        globalMinDistance.current = Infinity;
        globalClosestPoint.current.set(Infinity, Infinity, Infinity);

        /**
         * Floating sensor check if character is on ground
         */
        // First: check if ray hits any collider mesh (fast and stable)
        const useRaycastCheck = () => {
            // Update float raycaster position and direction
            floatRaycaster.current.set(floatSensorSegment.current.start, gravityDir.current)
            const intersects = floatRaycaster.current.intersectObjects(floatRaycastCandidates, false);
            if (intersects.length > 0) {
                const validHit = intersects.find(hit => {
                    floatNormalMatrix.current.getNormalMatrix(hit.object.matrixWorld)
                    floatHitNormal.current.copy(hit.normal!).applyMatrix3(floatNormalMatrix.current).normalize();
                    const angle = floatHitNormal.current.angleTo(upAxis.current);
                    return angle < maxSlope && hit.object.visible && !hit.object.userData.excludeFloatHit
                });
                if (validHit) {
                    globalMinDistance.current = validHit.distance;
                    globalClosestPoint.current.copy(validHit.point);
                    floatNormalMatrix.current.getNormalMatrix(validHit.object.matrixWorld)
                    floatHitNormal.current.copy(validHit.normal!).applyMatrix3(floatNormalMatrix.current).normalize();
                    currSlopeAngle.current = floatHitNormal.current.angleTo(upAxis.current);
                    groundFriction.current = validHit.object.userData.friction;
                    floatHitMesh.current = validHit.object;
                }
                return !!validHit
            }
            return false
        }

        // Second: fallback to shapecast if no ray hit (slow but accurate)
        const useShapecastCheck = () => {
            for (const mesh of colliderMeshesArray) {
                // Early exit if map is not visible and if map geometry boundsTree is not ready
                if (!mesh.visible || !mesh.geometry.boundsTree || mesh.userData.excludeFloatHit) continue;

                // Check floating hit for different meshes
                if (mesh instanceof THREE.InstancedMesh) {
                    for (let i = 0; i < mesh.count; i++) {
                        // Extract the instance matrix
                        mesh.getMatrixAt(i, instancedHitMatrix.current);
                        floatingCheck(mesh, instancedHitMatrix.current)
                    }
                } else {
                    floatingCheck(mesh, mesh.matrixWorld)
                }
            }
        }

        // Condition check and use proper method
        switch (floatCheckType) {
            case "RAYCAST":
                useRaycastCheck()
                break;
            case "SHAPECAST":
                useShapecastCheck()
                break;
            case "BOTH":
                if (!useRaycastCheck()) useShapecastCheck();
                break;
        }

        // If globalMinDistance.current is valid, sensor hits something. 
        // Apply proper floating force to float character
        if (globalMinDistance.current < Infinity) {
            // Check if detect ground below
            if (globalMinDistance.current < floatHeight + capsuleRadius) {
                isOnGround.current = true
                isFalling.current = false
                jump = false // Reset jump state if character is on ground
            }
            // If not jumping, calculate floating force
            if (!jump) {
                // Calculate spring force
                floatHitVec.current.subVectors(floatSensorSegment.current.start, globalClosestPoint.current);
                const springDist = floatHeight + capsuleRadius - floatHitVec.current.dot(upAxis.current);
                const springForce = floatSpringK * springDist;
                // Calculate damping force
                const dampingForce = floatDampingC * currentLinVel.current.dot(upAxis.current);
                const floatForce = springForce - dampingForce;
                // Apply force to character's velocity if on ground (force * dt / mass)
                if (isOnGround.current) currentLinVel.current.addScaledVector(upAxis.current, floatForce * delta / mass);
            } else {
                isOnGround.current = false;
            }
        } else {
            isOnGround.current = false;
            currSlopeAngle.current = 0;
        }
    }, [floatingCheck, capsuleRadius, floatHeight, floatSpringK, floatDampingC, mass, floatRaycastCandidates])
    /**
     * Back-up handleCollisionResponse
     */
    // const handleFloatingResponse = useCallback((colliderMeshesArray: THREE.Mesh[], jump: boolean, delta: number) => {
    //     // Exit if colliderMeshesArray is not ready
    //     if (colliderMeshesArray.length === 0) return

    //     /**
    //      * Floating sensor check if character is on ground
    //      */
    //     // Reset float sensor hit global info
    //     globalMinDistance.current = Infinity;
    //     globalClosestPoint.current.set(0, 0, 0);
    //     for (const mesh of colliderMeshesArray) {
    //         // Early exit if map is not visible and if map geometry boundsTree is not ready
    //         if (!mesh.visible || !mesh.geometry.boundsTree || mesh.userData.excludeFloatHit) continue;

    //         // Invert the collider matrix from world → local space
    //         floatInvertMatrix.current.copy(mesh.matrixWorld).invert();
    //         floatNormalInverseMatrix.current.getNormalMatrix(floatInvertMatrix.current);
    //         // Get collider matrix normal for later transform local → world space
    //         floatNormalMatrix.current.getNormalMatrix(mesh.matrixWorld)

    //         // Copy and transform the segment to local space
    //         localFloatSensorSegment.current.copy(floatSensorSegment.current).applyMatrix4(floatInvertMatrix.current);
    //         localFloatSensorBboxExpendPoint.current.copy(floatSensorBboxExpendPoint.current).applyMatrix4(floatInvertMatrix.current);

    //         // Compute bounding box in local space
    //         localFloatSensorBbox.current
    //             .makeEmpty()
    //             .expandByPoint(localFloatSensorSegment.current.start)
    //             .expandByPoint(localFloatSensorBboxExpendPoint.current)
    //             .expandByScalar(floatSensorRadius)

    //         // Reset float sensor hit point info
    //         localMinDistance.current = Infinity;
    //         localClosestPoint.current.set(0, 0, 0);

    //         // Check if floating ray hits any map faces, 
    //         // and find the closest point to sensor start point
    //         mesh.geometry.boundsTree.shapecast({
    //             // If not intersects with float sensor bbox, just stop entire shapecast  
    //             intersectsBounds: box => box.intersectsBox(localFloatSensorBbox.current),
    //             // If intersects with float sensor bbox, deeply check collision with float sensor segment
    //             intersectsTriangle: tri => {
    //                 tri.closestPointToSegment(localFloatSensorSegment.current, triHitPoint.current, segHitPoint.current);
    //                 localUpAxis.current.copy(upAxis.current).applyMatrix3(floatNormalInverseMatrix.current).normalize();
    //                 const horizontalDistance = closestPointHorizontalDis.current.subVectors(localFloatSensorSegment.current.start, triHitPoint.current).projectOnPlane(localUpAxis.current).lengthSq();
    //                 const verticalDistance = closestPointVerticalDis.current.subVectors(localFloatSensorSegment.current.start, triHitPoint.current).projectOnVector(localUpAxis.current).lengthSq();

    //                 // Only accept triangle hit if inside sensor range
    //                 if (horizontalDistance < floatSensorRadius * floatSensorRadius &&
    //                     verticalDistance < (capsuleRadius + floatHeight + floatPullBackHeight) ** 2
    //                 ) {
    //                     // Local space hit tri normal
    //                     tri.getNormal(triNormal.current);
    //                     // Transform normal to world space using normalMatrix
    //                     triNormal.current.applyMatrix3(floatNormalMatrix.current).normalize();
    //                     // Transform hit point to world space
    //                     triHitPoint.current.applyMatrix4(mesh.matrixWorld);

    //                     // Store the closest and within max slope point
    //                     const slopeAngle = triNormal.current.angleTo(upAxis.current);
    //                     if (verticalDistance < localMinDistance.current && slopeAngle < maxSlope) {
    //                         localMinDistance.current = verticalDistance;
    //                         localClosestPoint.current.copy(triHitPoint.current);
    //                         localHitNormal.current.copy(triNormal.current);
    //                     }
    //                 }
    //             }
    //         });

    //         /**
    //          * bvh.shapecast might hit multiple faces, 
    //          * and only the closest one return a valid number, 
    //          * other faces would return infinity.
    //          * Store only the closest point to globalMinDistance/globalClosestPoint
    //          */
    //         if (localMinDistance.current < globalMinDistance.current) {
    //             globalMinDistance.current = localMinDistance.current;
    //             globalClosestPoint.current.copy(localClosestPoint.current);
    //             floatHitNormal.current.copy(localHitNormal.current);
    //             currSlopeAngle.current = floatHitNormal.current.angleTo(upAxis.current);
    //             isOverMaxSlope.current = currSlopeAngle.current > maxSlope;
    //             groundFriction.current = mesh.userData.friction;
    //             floatHitMesh.current = mesh;
    //         }
    //     }

    //     // If globalMinDistance.current is valid, sensor hits something. 
    //     // Apply proper floating force to float character
    //     if (globalMinDistance.current < Infinity) {
    //         // Check character is on ground and if not over max slope
    //         if (!isOverMaxSlope.current) {
    //             isOnGround.current = true
    //             isFalling.current = false
    //             // Calculate spring force
    //             floatHitVec.current.subVectors(floatSensorSegment.current.start, globalClosestPoint.current)
    //             const springForce = floatSpringK * (floatHeight + capsuleRadius - floatHitVec.current.dot(upAxis.current));
    //             // Calculate damping force
    //             const dampingForce = floatDampingC * currentLinVel.current.dot(upAxis.current);
    //             // Total float force
    //             const floatForce = springForce - dampingForce;
    //             // Apply force to character's velocity (force * dt / mass)
    //             if (!jump) currentLinVel.current.addScaledVector(upAxis.current, floatForce * delta / mass)
    //         }
    //     } else {
    //         isOnGround.current = false
    //         currSlopeAngle.current = 0
    //     }
    // }, [floatSensorRadius, capsuleRadius, floatHeight, floatPullBackHeight, maxSlope, floatSpringK, floatDampingC, mass])

    /**
     * Update character position/rotation with moving platform
     */
    const updateCharacterWithPlatform = useCallback(() => {
        // Exit if characterGroupRef or characterModelRef is not ready
        if (!characterGroupRef.current || !characterModelRef.current) return

        /**
         * Clear platform offset if grounded on static collider
         */
        if (isOnGround.current &&
            floatHitMesh.current &&
            (floatHitMesh.current.userData.type === "STATIC" || (floatHitMesh.current.userData.type === "KINEMATIC" && floatHitMesh.current.userData.active === false)) &&
            totalPlatformDeltaPos.current.lengthSq() > 0
        ) {
            totalPlatformDeltaPos.current.set(0, 0, 0);
            return;
        }

        /**
         * Apply platform inertia motion when character just left a platform
         */
        if (!isOnGround.current && totalPlatformDeltaPos.current.lengthSq() > 0) {
            characterGroupRef.current.position.add(totalPlatformDeltaPos.current);
        }

        /**
         * Only update when character is on KINEMATIC platform
         */
        if (!isOnGround.current ||
            !floatHitMesh.current ||
            floatHitMesh.current.userData.type !== "KINEMATIC" ||
            (floatHitMesh.current.userData.type === "KINEMATIC" && floatHitMesh.current.userData.active === false)
        ) {
            isOnMovingPlatform.current = false
            return;
        }

        // Retrieve platform information from globle store
        const center = floatHitMesh.current.userData.center as THREE.Vector3;
        const deltaPos = floatHitMesh.current.userData.deltaPos as THREE.Vector3;
        const deltaQuat = floatHitMesh.current.userData.deltaQuat as THREE.Quaternion;
        const rotationAxis = floatHitMesh.current.userData.rotationAxis as THREE.Vector3;
        const rotationAngle = floatHitMesh.current.userData.rotationAngle as number;
        isOnMovingPlatform.current = true

        /**
         * Update character group linear/rotation position with platform
         */
        // Compute relative position from platform center to hit point before rotation
        relativeHitPoint.current.copy(globalClosestPoint.current).sub(center);
        // Apply rotation to this relative vector and get delta movement due to rotation
        rotationDeltaPos.current.copy(relativeHitPoint.current).applyQuaternion(deltaQuat).sub(relativeHitPoint.current);
        // Combine rotation delta and translation delta pos and apply to character
        totalPlatformDeltaPos.current.copy(rotationDeltaPos.current).add(deltaPos);
        characterGroupRef.current.position.add(totalPlatformDeltaPos.current);

        /**
         * Update character model rotation if platform is rotate along up-axis
         */
        if (rotationAngle > 1e-6) {
            // Check if rotation is primarily around upAxis
            const projection = rotationAxis.dot(upAxis.current);
            if (Math.abs(projection) > 0.9) {
                yawQuaternion.current.setFromAxisAngle(upAxis.current, rotationAngle * projection)
                characterModelRef.current.quaternion.premultiply(yawQuaternion.current);
            }
        }
    }, [])

    /**
     * Update character status for exporting
     */
    const updateCharacterAnimation = useCallback((run: boolean, jump: boolean) => {
        // On ground condition
        if (isOnGround.current) {
            if (!prevIsOnGround.current) return "JUMP_LAND";
            if (inputDir.current.lengthSq() === 0) return "IDLE";
            return run ? "RUN" : "WALK";
        }
        // In the air condition
        else {
            if (prevIsOnGround.current && jump) return "JUMP_START";
            return isFalling.current ? "JUMP_FALL" : "JUMP_IDLE";
        }
    }, [])
    const updateCharacterStatus = useCallback((run: boolean, jump: boolean) => {
        // Update character control status
        characterModelRef.current?.getWorldPosition(characterStatus.position)
        characterModelRef.current?.getWorldQuaternion(characterStatus.quaternion)
        characterStatus.linvel.copy(currentLinVel.current)
        characterStatus.inputDir.copy(inputDir.current)
        characterStatus.movingDir.copy(movingDir.current)
        characterStatus.isOnGround = isOnGround.current
        characterStatus.isOnMovingPlatform = isOnMovingPlatform.current
        // Update character animation status
        characterStatus.animationStatus = updateCharacterAnimation(run, jump)
        if (prevAnimation.current !== characterStatus.animationStatus) {
            useAnimationStore.getState().setAnimationStatus(characterStatus.animationStatus)
            prevAnimation.current = characterStatus.animationStatus
        }
    }, [])

    /**
     * Bind controller functions to ref
     */
    const resetLinVel = useCallback(() => currentLinVel.current.set(0, 0, 0), [])
    const addLinVel = useCallback((velocity: THREE.Vector3) => currentLinVel.current.add(velocity), [])
    const setLinVel = useCallback((velocity: THREE.Vector3) => currentLinVel.current.copy(velocity), [])
    const setMovement = useCallback((movement: MovementInput) => {
        if (movement.forward !== undefined) forwardState.current = movement.forward;
        if (movement.backward !== undefined) backwardState.current = movement.backward;
        if (movement.leftward !== undefined) leftwardState.current = movement.leftward;
        if (movement.rightward !== undefined) rightwardState.current = movement.rightward;
        if (movement.joystick) joystickState.current.set(movement.joystick.x, movement.joystick.y);
        if (movement.run !== undefined) runState.current = movement.run;
        if (movement.jump !== undefined) jumpState.current = movement.jump;
    }, [])
    useImperativeHandle(ref, () => {
        return {
            get group() {
                return characterGroupRef.current;
            },
            get model() {
                return characterModelRef.current;
            },
            resetLinVel,
            addLinVel,
            setLinVel,
            setMovement,
        };
    }, [resetLinVel, addLinVel, setLinVel, setMovement]);

    /**
     * Update debug indicators function
     */
    const updateDebugger = useCallback(() => {
        // Apply the updated values to character segment start/end
        debugLineStart.current?.position.copy(characterSegment.current.start)
        debugLineEnd.current?.position.copy(characterSegment.current.end)

        //  Apply the updated values to floating sensor segment start/end
        debugRaySensorStart.current?.position.copy(floatSensorSegment.current.start)
        debugRaySensorEnd.current?.position.copy(floatSensorSegment.current.end)

        // Update stand point to follow globalClosestPoint
        standPointRef.current?.position.copy(globalClosestPoint.current);

        // Update camera looking direction indicator to follow character pos and looking dir
        if (characterGroupRef.current)
            lookDirRef.current?.position.copy(characterGroupRef.current.position).addScaledVector(upAxis.current, 0.7)
        lookDirRef.current?.lookAt(lookDirRef.current?.position.clone().add(camProjDir.current))

        // Update input direction arrow
        inputDirRef.current?.position.copy(characterSegment.current.end)
        inputDirRef.current?.setDirection(inputDir.current)
        inputDirRef.current?.setLength(inputDir.current.lengthSq())

        // Update moving velocity arrow and length
        moveDirRef.current?.position.copy(characterSegment.current.end)
        moveDirRef.current?.setDirection(currentLinVel.current)
        moveDirRef.current?.setLength(currentLinVel.current.length() / maxWalkSpeed)
    }, [])

    useFrame((state, delta) => {
        /**
         * If paused or delay, skip all the functions
         */
        if (paused || state.clock.elapsedTime < delay) return

        /**
         * Apply slow motion to delta time
         */
        const deltaTime = Math.min(1 / 45, delta) * slowMotionFactor // Fixed smulation at minimum 45 FPS
        // if (delta > 1 / 45) console.warn("Low FPS detected — simulation capped to 45 FPS for stability")

        /**
         * Get camera azimuthal angle
         */
        // const camAngle = getAzimuthalAngle(state.camera, upAxis);

        /**
         * Getting virtual buttons info from useButtonStore
         */
        const { buttons } = useButtonStore.getState();

        /**
         * Getting all the useful keys from useKeyboardControls
         */
        // const { forward, backward, leftward, rightward, jump, run } = isInsideKeyboardControls && getKeys ? getKeys() : presetKeys;
        const keys = isInsideKeyboardControls && getKeys ? getKeys() : presetKeys;
        const forward = forwardState.current || keys.forward;
        const backward = backwardState.current || keys.backward;
        const leftward = leftwardState.current || keys.leftward;
        const rightward = rightwardState.current || keys.rightward;
        const run = runState.current || keys.run || buttons.run;
        const jump = jumpState.current || keys.jump || buttons.jump;

        /**
         * Handle character movement input
         */
        setInputDirection({ forward, backward, leftward, rightward, joystick: joystickState.current })
        // Apply user input to character moving velocity
        handleCharacterMovement(run, deltaTime)
        // Character jump input
        if (jump && isOnGround.current) currentLinVel.current.y = jumpVel
        // Update character moving diretion
        movingDir.current.copy(currentLinVel.current).normalize()
        // Update character current linear velocity on up axis plane
        currentLinVelOnPlane.current.copy(currentLinVel.current).projectOnPlane(upAxis.current)

        /**
         * Check if character is sleeping,
         * If so, pause functions to save performance
         */
        checkCharacterSleep(jump, deltaTime)
        if (!isSleeping.current) {
            /**
             * Apply custom gravity to character current velocity
             */
            if (!isOnGround.current) applyGravity(deltaTime)

            /**
             * Update collider segement/bbox to new position for collision check
             */
            updateSegmentBBox()

            /**
             * Handle character collision response
             * Apply contact normal and contact depth to character current velocity
             */
            handleCollisionResponse(colliderMeshesArray, deltaTime)

            /**
             * Handle character floating response
             */
            handleFloatingResponse(colliderMeshesArray, jump, deltaTime)

            /**
             * Update character position and rotation with moving platform
             */
            updateCharacterWithPlatform()

            /**
             * Apply sum-up velocity to move character position
             */
            if (characterGroupRef.current)
                characterGroupRef.current.position.addScaledVector(currentLinVel.current, deltaTime)

            /**
             * Update character status for exporting
             */
            updateCharacterStatus(run, jump)

            /**
             * Save previous grounded state
             */
            prevIsOnGround.current = isOnGround.current
        }

        /**
         * Update debug indicators
         */
        if (debug) updateDebugger()
    })

    return (
        <Suspense fallback={null} >
            <group {...props} ref={characterGroupRef} dispose={null} >
                {/* Character debug capsule collider */}
                {debug && <mesh ref={characterColliderRef}>
                    <capsuleGeometry args={colliderCapsuleArgs} />
                    <meshNormalMaterial wireframe />
                </mesh>}
                {/* Character model */}
                <group name="BVHEcctrl-Model" ref={characterModelRef}>
                    {children}
                </group>
            </group>

            {/* Debug helper */}
            {debug &&
                <group>
                    <TransformControls object={characterGroupRef.current!} />
                    {/* <TransformControls mode="rotate" object={characterGroupRef} scale={2} /> */}

                    {/* Character bunding box debugger */}
                    <box3Helper args={[characterBbox.current]} />
                    {/* Character segment debugger */}
                    <mesh ref={debugLineStart}>
                        <octahedronGeometry args={[0.05, 0]} />
                        <meshNormalMaterial />
                    </mesh>
                    <mesh ref={debugLineEnd}>
                        <octahedronGeometry args={[0.05, 0]} />
                        <meshNormalMaterial />
                    </mesh>

                    {/* Float ray sensor bunding box debugger */}
                    <box3Helper args={[floatSensorBbox.current]} />
                    {/* Float ray sensor segment debugger */}
                    <mesh ref={debugRaySensorStart}>
                        <octahedronGeometry args={[0.1, 0]} />
                        <meshBasicMaterial color={"yellow"} wireframe />
                    </mesh>
                    <mesh ref={debugRaySensorEnd}>
                        <octahedronGeometry args={[0.1, 0]} />
                        <meshBasicMaterial color={"yellow"} wireframe />
                    </mesh>

                    {/* Camera looking direction debugger */}
                    <mesh scale={[1, 0.5, 4]} ref={lookDirRef}>
                        <octahedronGeometry args={[0.1, 0]} />
                        <meshNormalMaterial />
                    </mesh>

                    {/* Character input arrow debugger */}
                    <arrowHelper ref={inputDirRef} args={[undefined, undefined, undefined, "#00f"]} />

                    {/* Character moving velocity arrow debugger */}
                    <arrowHelper ref={moveDirRef} args={[undefined, undefined, undefined, "#f00"]} />

                    {/* Character standing point debugger */}
                    <mesh ref={standPointRef} >
                        <octahedronGeometry args={[0.12, 0]} />
                        <meshBasicMaterial color={"red"} transparent opacity={0.2} />
                    </mesh>
                </group>
            }
        </Suspense>
    );
})

export default React.memo(BVHEcctrl) as ForwardRefExoticComponent<EcctrlProps & RefAttributes<BVHEcctrlApi>>;

/**
 * Export values/features/functions
 */
export const characterStatus: CharacterStatus = {
    position: new THREE.Vector3(),
    linvel: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    inputDir: new THREE.Vector3(),
    movingDir: new THREE.Vector3(),
    isOnGround: false,
    isOnMovingPlatform: false,
    animationStatus: "IDLE",
};

/**
 * Export ecctrl types
 */
export interface EcctrlProps extends Omit<React.ComponentProps<'group'>, 'ref'> {
    children?: ReactNode;
    debug?: boolean;
    colliderCapsuleArgs?: [radius: number, length: number, capSegments: number, radialSegments: number];
    paused?: boolean;
    delay?: number;
    gravity?: number;
    fallGravityFactor?: number;
    maxFallSpeed?: number;
    mass?: number;
    sleepTimeout?: number;
    slowMotionFactor?: number;
    turnSpeed?: number;
    maxWalkSpeed?: number;
    maxRunSpeed?: number;
    acceleration?: number;
    deceleration?: number;
    counterAccFactor?: number;
    airDragFactor?: number;
    jumpVel?: number;
    floatCheckType?: FloatCheckType;
    maxSlope?: number;
    floatHeight?: number;
    floatPullBackHeight?: number;
    floatSensorRadius?: number;
    floatSpringK?: number;
    floatDampingC?: number;
    collisionCheckIteration?: number;
    // collisionPushBackStrength?: number;
    collisionPushBackVelocity?: number;
    collisionPushBackDamping?: number;
    collisionPushBackThreshold?: number;
};

export interface BVHEcctrlApi {
    group: THREE.Group | null;
    model: THREE.Group | null;
    resetLinVel: () => void;
    addLinVel: (v: THREE.Vector3) => void;
    setLinVel: (v: THREE.Vector3) => void;
    setMovement: (input: MovementInput) => void;
}

export interface CharacterStatus {
    position: THREE.Vector3
    linvel: THREE.Vector3
    quaternion: THREE.Quaternion
    inputDir: THREE.Vector3
    movingDir: THREE.Vector3
    isOnGround: boolean
    isOnMovingPlatform: boolean
    animationStatus: CharacterAnimationStatus
}

