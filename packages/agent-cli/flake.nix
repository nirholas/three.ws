{
  description = "three-ws-agent: run a three.ws agent on your own machine";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAll (pkgs: rec {
        three-ws-agent = pkgs.buildNpmPackage {
          pname = "three-ws-agent";
          version = (builtins.fromJSON (builtins.readFile ./package.json)).version;
          src = pkgs.lib.cleanSource ./.;
          nodejs = pkgs.nodejs_22;
          # Dependencies come straight from package-lock.json, so there is no
          # npmDepsHash to keep in sync when the lockfile changes.
          npmDeps = pkgs.importNpmLock { npmRoot = ./.; };
          npmConfigHook = pkgs.importNpmLock.npmConfigHook;
          dontNpmBuild = true;
          npmInstallFlags = [ "--omit=dev" ];
          meta = {
            description = "Run a three.ws agent on your own machine or VPS";
            homepage = "https://three.ws/docs/agent-cli";
            license = pkgs.lib.licenses.asl20;
            mainProgram = "three-ws-agent";
          };
        };
        default = three-ws-agent;
      });

      apps = forAll (pkgs: {
        default = {
          type = "app";
          program = "${self.packages.${pkgs.system}.default}/bin/three-ws-agent";
        };
      });

      devShells = forAll (pkgs: {
        default = pkgs.mkShell { packages = [ pkgs.nodejs_22 ]; };
      });
    };
}
