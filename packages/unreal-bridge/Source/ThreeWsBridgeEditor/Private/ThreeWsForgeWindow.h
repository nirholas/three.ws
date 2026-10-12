// Slate dock tab: a prompt field, a tier dropdown, and a Generate button
// that runs a real text-to-3D generation and drops the imported mesh into
// the active editor level.
#pragma once

#include "CoreMinimal.h"
#include "ThreeWsClient.h"
#include "Widgets/SCompoundWidget.h"

class SEditableTextBox;
class STextBlock;

class SThreeWsForgeWindow : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SThreeWsForgeWindow) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

private:
	TSharedPtr<FThreeWsClient> Client;
	TSharedPtr<SEditableTextBox> PromptBox;
	TSharedPtr<STextBlock> StatusText;
	TArray<FString> Tiers;
	int32 SelectedTierIndex = 0;
	bool bBusy = false;

	FReply OnGenerateClicked();
	void SetStatus(const FString& Message);
	void RunGeneration(FString Prompt, FString Tier);
	void OnGlbReady(const FString& GlbPath);
};
