#include "ThreeWsBridgeEditorModule.h"

#include "Framework/Docking/TabManager.h"
#include "ThreeWsForgeWindow.h"
#include "ToolMenus.h"
#include "Widgets/Docking/SDockTab.h"

static const FName ThreeWsForgeTabName("ThreeWsForgeBridge");

void FThreeWsBridgeEditorModule::StartupModule()
{
	FGlobalTabmanager::Get()->RegisterNomadTabSpawner(ThreeWsForgeTabName,
		FOnSpawnTab::CreateLambda([](const FSpawnTabArgs&) -> TSharedRef<SDockTab>
		{
			return SNew(SDockTab)
				.TabRole(ETabRole::NomadTab)
				[
					SNew(SThreeWsForgeWindow)
				];
		}))
		.SetDisplayName(FText::FromString(TEXT("three.ws Forge")))
		.SetTooltipText(FText::FromString(TEXT("Generate a mesh from a prompt with the three.ws Forge pipeline")))
		.SetMenuType(ETabSpawnerMenuType::Hidden);

	UToolMenus::RegisterStartupCallback(FSimpleMulticastDelegate::FDelegate::CreateRaw(this, &FThreeWsBridgeEditorModule::RegisterMenus));
}

void FThreeWsBridgeEditorModule::ShutdownModule()
{
	FGlobalTabmanager::Get()->UnregisterNomadTabSpawner(ThreeWsForgeTabName);
}

void FThreeWsBridgeEditorModule::RegisterMenus()
{
	FToolMenuOwnerScoped OwnerScoped(this);
	UToolMenu* Menu = UToolMenus::Get()->ExtendMenu("LevelEditor.MainMenu.Window");
	FToolMenuSection& Section = Menu->FindOrAddSection("ThreeWs");
	Section.AddMenuEntry(
		"ThreeWsForgeBridge",
		FText::FromString(TEXT("three.ws Forge Bridge")),
		FText::FromString(TEXT("Generate a mesh from a prompt with the three.ws Forge pipeline")),
		FSlateIcon(),
		FUIAction(FExecuteAction::CreateRaw(this, &FThreeWsBridgeEditorModule::OpenForgeWindow)));
}

void FThreeWsBridgeEditorModule::OpenForgeWindow()
{
	FGlobalTabmanager::Get()->TryInvokeTab(ThreeWsForgeTabName);
}

IMPLEMENT_MODULE(FThreeWsBridgeEditorModule, ThreeWsBridgeEditor)
