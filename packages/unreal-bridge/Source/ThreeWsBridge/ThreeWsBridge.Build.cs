// Copyright 2026 nirholas. Licensed under the Apache License, Version 2.0.
using UnrealBuildTool;

public class ThreeWsBridge : ModuleRules
{
	public ThreeWsBridge(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"HTTP",
			"Json",
			"JsonUtilities",
			"InterchangeCore",
			"InterchangeEngine",
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"Projects",
		});
	}
}
