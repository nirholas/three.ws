// Hands a downloaded Forge GLB to Unreal's own Interchange glTF pipeline.
// No glTF parsing lives here, per specs/ENGINE_BRIDGE.md section 6/7.
// Requires Interchange glTF import enabled: Project Settings > Editor >
// Interchange Import > glTF, or UE 5.3+'s default-on setting.
#pragma once

#include "CoreMinimal.h"

struct THREEWSBRIDGE_API FForgeImportSettings
{
	bool bGenerateColliders = false;
	bool bImportMaterials = true;
	float Scale = 1.0f;
	/** Content-browser destination, e.g. /Game/ThreeWsForge/Generated. */
	FString DestinationPath = TEXT("/Game/ThreeWsForge/Generated");
};

class THREEWSBRIDGE_API FThreeWsForgeImporter
{
public:
	/**
	 * Imports a local .glb through UInterchangeManager::ImportAssetAsync and
	 * calls OnComplete with the primary imported UObject (a UStaticMesh or
	 * USkeletalMesh) once Interchange reports the import done, or nullptr on
	 * failure. Call from the game/editor thread; the callback also fires on
	 * the game/editor thread.
	 */
	static void ImportGlb(const FString& GlbPath, const FForgeImportSettings& Settings,
		TFunction<void(UObject* ImportedAsset, const FString& Error)> OnComplete);
};
