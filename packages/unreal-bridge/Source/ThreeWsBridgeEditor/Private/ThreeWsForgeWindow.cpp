#include "ThreeWsForgeWindow.h"

#include "Editor.h"
#include "EditorViewportClient.h"
#include "Engine/StaticMeshActor.h"
#include "Components/StaticMeshComponent.h"
#include "HAL/PlatformFileManager.h"
#include "Misc/Paths.h"
#include "ThreeWsForgeImporter.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SComboBox.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Text/STextBlock.h"

void SThreeWsForgeWindow::Construct(const FArguments& InArgs)
{
	Client = MakeShared<FThreeWsClient>();
	Tiers = { TEXT("draft"), TEXT("standard"), TEXT("high") };
	SelectedTierIndex = 0;

	TArray<TSharedPtr<FString>> TierOptions;
	for (const FString& Tier : Tiers)
	{
		TierOptions.Add(MakeShared<FString>(Tier));
	}

	ChildSlot
	[
		SNew(SBox)
		.Padding(16.0f)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 8)
			[
				SNew(STextBlock).Text(FText::FromString(TEXT("three.ws Forge")))
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 8)
			[
				SAssignNew(PromptBox, SEditableTextBox)
				.HintText(FText::FromString(TEXT("a weathered lighthouse")))
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 8)
			[
				SNew(SComboBox<TSharedPtr<FString>>)
				.OptionsSource(&TierOptions)
				.OnGenerateWidget_Lambda([](TSharedPtr<FString> Item)
				{
					return SNew(STextBlock).Text(FText::FromString(*Item));
				})
				.OnSelectionChanged_Lambda([this](TSharedPtr<FString> Item, ESelectInfo::Type)
				{
					if (Item.IsValid())
					{
						SelectedTierIndex = Tiers.IndexOfByKey(*Item);
					}
				})
				.InitiallySelectedItem(TierOptions[0])
				[
					SNew(STextBlock).Text(FText::FromString(Tiers[0]))
				]
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 8)
			[
				SNew(SButton)
				.Text(FText::FromString(TEXT("Generate and import")))
				.IsEnabled_Lambda([this]() { return !bBusy; })
				.OnClicked(this, &SThreeWsForgeWindow::OnGenerateClicked)
			]
			+ SVerticalBox::Slot().AutoHeight()
			[
				SAssignNew(StatusText, STextBlock).Text(FText::FromString(TEXT("Idle.")))
			]
		]
	];
}

void SThreeWsForgeWindow::SetStatus(const FString& Message)
{
	if (StatusText.IsValid())
	{
		StatusText->SetText(FText::FromString(Message));
	}
}

FReply SThreeWsForgeWindow::OnGenerateClicked()
{
	if (bBusy || !PromptBox.IsValid())
	{
		return FReply::Handled();
	}
	const FString Prompt = PromptBox->GetText().ToString().TrimStartAndEnd();
	if (Prompt.IsEmpty())
	{
		SetStatus(TEXT("Type a prompt first."));
		return FReply::Handled();
	}
	bBusy = true;
	RunGeneration(Prompt, Tiers[SelectedTierIndex]);
	return FReply::Handled();
}

void SThreeWsForgeWindow::RunGeneration(FString Prompt, FString Tier)
{
	SetStatus(FString::Printf(TEXT("Submitting \"%s\"..."), *Prompt));

	TWeakPtr<SThreeWsForgeWindow> WeakSelf = SharedThis(this);
	Client->SubmitText(Prompt, Tier, TEXT("image"), TEXT(""), TEXT("1:1"),
		[this, WeakSelf, Prompt](FForgeJobResult Submitted)
		{
			TSharedPtr<SThreeWsForgeWindow> Self = WeakSelf.Pin();
			if (!Self.IsValid())
			{
				return;
			}
			if (!Submitted.bOk)
			{
				SetStatus(FString::Printf(TEXT("Submit failed: %s"), *Submitted.Error));
				bBusy = false;
				return;
			}

			auto HandleGlbUrl = [this, WeakSelf](FString GlbUrl)
			{
				TSharedPtr<SThreeWsForgeWindow> InnerSelf = WeakSelf.Pin();
				if (!InnerSelf.IsValid())
				{
					return;
				}
				SetStatus(TEXT("Downloading..."));
				const FString Destination = FPaths::Combine(FPaths::ProjectIntermediateDir(), TEXT("ThreeWsForge"), TEXT("forge_tmp.glb"));
				Client->DownloadGlb(GlbUrl, Destination,
					[this, WeakSelf](FForgeDownloadResult Downloaded)
					{
						TSharedPtr<SThreeWsForgeWindow> DlSelf = WeakSelf.Pin();
						if (!DlSelf.IsValid())
						{
							return;
						}
						if (!Downloaded.bOk)
						{
							SetStatus(FString::Printf(TEXT("Download failed: %s"), *Downloaded.Error));
							bBusy = false;
							return;
						}
						OnGlbReady(Downloaded.FilePath);
					});
			};

			if (!Submitted.GlbUrl.IsEmpty())
			{
				HandleGlbUrl(Submitted.GlbUrl);
				return;
			}

			SetStatus(FString::Printf(TEXT("Generating on %s..."), *Submitted.Backend));
			Client->WaitForGlb(Submitted.JobId, 600.0f,
				[this, WeakSelf, HandleGlbUrl](FForgeJobResult Finished)
				{
					TSharedPtr<SThreeWsForgeWindow> WaitSelf = WeakSelf.Pin();
					if (!WaitSelf.IsValid())
					{
						return;
					}
					if (!Finished.bOk)
					{
						SetStatus(FString::Printf(TEXT("Generation failed: %s"), *Finished.Error));
						bBusy = false;
						return;
					}
					HandleGlbUrl(Finished.GlbUrl);
				});
		});
}

void SThreeWsForgeWindow::OnGlbReady(const FString& GlbPath)
{
	SetStatus(TEXT("Importing..."));

	FForgeImportSettings Settings;
	Settings.bGenerateColliders = true;

	TWeakPtr<SThreeWsForgeWindow> WeakSelf = SharedThis(this);
	FThreeWsForgeImporter::ImportGlb(GlbPath, Settings,
		[this, WeakSelf](UObject* ImportedAsset, const FString& Error)
		{
			TSharedPtr<SThreeWsForgeWindow> Self = WeakSelf.Pin();
			if (!Self.IsValid())
			{
				return;
			}
			bBusy = false;
			if (!ImportedAsset)
			{
				SetStatus(FString::Printf(TEXT("Import failed: %s"), *Error));
				return;
			}

			if (UStaticMesh* Mesh = Cast<UStaticMesh>(ImportedAsset))
			{
				if (GEditor)
				{
					if (UWorld* World = GEditor->GetEditorWorldContext().World())
					{
						AStaticMeshActor* Actor = World->SpawnActor<AStaticMeshActor>();
						if (Actor && Actor->GetStaticMeshComponent())
						{
							Actor->GetStaticMeshComponent()->SetStaticMesh(Mesh);
							Actor->SetActorLabel(Mesh->GetName());
							GEditor->SelectNone(false, true);
							GEditor->SelectActor(Actor, true, true);
						}
					}
				}
			}

			SetStatus(FString::Printf(TEXT("Imported %s."), *ImportedAsset->GetName()));
		});
}
