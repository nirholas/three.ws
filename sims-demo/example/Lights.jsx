export default function Lights() {
  return (
    <>
      <directionalLight
        intensity={1.6}
        color={"#FFFFED"}
        castShadow
        shadow-bias={-0.00005}
        position={[-10, 20, 10]}
        shadow-mapSize={[2048,2048]}
      >
        <orthographicCamera attach="shadow-camera" args={[-70, 70, 70, -70]} />
      </directionalLight>
      <ambientLight intensity={0.8} />
    </>
  );
}
