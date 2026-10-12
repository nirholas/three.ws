#include "ThreeWsForgeImporter.h"

#include "InterchangeManager.h"
#include "InterchangeSourceData.h"
#include "Engine/StaticMesh.h"
#include "Materials/Material.h"
#include "Misc/Paths.h"
#include "PhysicsEngine/BodySetup.h"
#include "PhysicsEngine/BoxElem.h"

namespace
{
	// Applies the shared import_materials / generate_colliders settings
	// from specs/ENGINE_BRIDGE.md section 7. Mirrors what
	// packages/unity-bridge does with a MeshCollider and packages/godot-bridge
	// does with a ConvexPolygonShape3D: a simple, real collision proxy, not a
	// convex decomposition (Interchange owns the glTF-specific pipeline
	// options; this bridge only normalizes the cross-engine knobs).
	void ApplyForgeImportSettings(UStaticMesh* Mesh, const FForgeImportSettings& Settings)
	{
		if (!Mesh)
		{
			return;
		}

		if (!Settings.bImportMaterials)
		{
			UMaterialInterface* Flat = UMaterial::GetDefaultMaterial(MD_Surface);
			const TArray<FStaticMaterial>& Materials = Mesh->GetStaticMaterials();
			for (int32 Index = 0; Index < Materials.Num(); Index++)
			{
				Mesh->SetMaterial(Index, Flat);
			}
		}

		if (Settings.bGenerateColliders)
		{
			Mesh->CreateBodySetup();
			if (UBodySetup* BodySetup = Mesh->GetBodySetup())
			{
				BodySetup->RemoveSimpleCollision();

				FKBoxElem BoxElem;
				const FBox Bounds = Mesh->GetBoundingBox();
				BoxElem.Center = Bounds.GetCenter();
				const FVector Size = Bounds.GetSize();
				BoxElem.X = Size.X;
				BoxElem.Y = Size.Y;
				BoxElem.Z = Size.Z;
				BodySetup->AggGeom.BoxElems.Add(BoxElem);
				BodySetup->CollisionTraceFlag = CTF_UseSimpleAndComplex;
				BodySetup->CreatePhysicsMeshes();
			}
		}

		Mesh->PostEditChange();
	}
}

void FThreeWsForgeImporter::ImportGlb(const FString& GlbPath, const FForgeImportSettings& Settings,
	TFunction<void(UObject*, const FString&)> OnComplete)
{
	if (!FPaths::FileExists(GlbPath))
	{
		OnComplete(nullptr, FString::Printf(TEXT("ThreeWsForgeImporter: %s does not exist"), *GlbPath));
		return;
	}

	UInterchangeManager& Manager = UInterchangeManager::GetInterchangeManager();
	UInterchangeSourceData* SourceData = Manager.CreateSourceData(GlbPath);
	if (!SourceData)
	{
		OnComplete(nullptr, TEXT("ThreeWsForgeImporter: could not create Interchange source data for the downloaded GLB"));
		return;
	}

	FImportAssetParameters Params;
	Params.bIsAutomated = true;
	Params.bReplaceExisting = true;

	UE::Interchange::FAssetImportResultRef Result =
		Manager.ImportAssetAsync(Settings.DestinationPath, SourceData, Params);

	Result->OnDone.AddLambda(
		[Settings, OnComplete](UE::Interchange::FImportResult& ImportResult)
		{
			const TArray<UObject*> Imported = ImportResult.GetImportedObjects();
			if (Imported.Num() == 0)
			{
				OnComplete(nullptr, TEXT("Interchange reported no imported objects for this GLB"));
				return;
			}

			UObject* Primary = Imported[0];
			ApplyForgeImportSettings(Cast<UStaticMesh>(Primary), Settings);

			// Scale from FForgeImportSettings is applied by the caller at
			// the actor level: the imported asset itself keeps its native
			// scale, matching how the editor window and runtime sample
			// place it (see README).
			OnComplete(Primary, TEXT(""));
		});
}
