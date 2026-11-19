// Copyright 2026 nirholas. Licensed under the Apache License, Version 2.0.
using UnrealBuildTool;

public class ThreeWsBridgeEditor : ModuleRules
{
	public ThreeWsBridgeEditor(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"ThreeWsBridge",
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"Slate",
			"SlateCore",
			"UnrealEd",
			"ToolMenus",
			"InputCore",
			"EditorStyle",
		});
	}
}
