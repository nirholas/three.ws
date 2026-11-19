// Copyright 2026 nirholas. Licensed under the Apache License, Version 2.0.
#pragma once

#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"

class FThreeWsBridgeEditorModule : public IModuleInterface
{
public:
	virtual void StartupModule() override;
	virtual void ShutdownModule() override;

private:
	void RegisterMenus();
	void OpenForgeWindow();
};
