// Force-enable Lookin compilation guards for bridge build
#ifndef SHOULD_COMPILE_LOOKIN_SERVER
#define SHOULD_COMPILE_LOOKIN_SERVER 1
#endif
#ifndef LOOKIN_BRIDGE
#define LOOKIN_BRIDGE 1
#endif

#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>

// Lookin Shared models — copied from LookinServer/Src/Main/Shared
#import "../LookinIvarTrace.h"
#import "../LookinDefines.h"
#import "../LookinCodingValueType.h"
#import "../LookinObject.h"
#import "../LookinAppInfo.h"
#import "../LookinConnectionAttachment.h"
#import "../LookinConnectionResponseAttachment.h"
#import "../LookinHierarchyInfo.h"
#import "../LookinDisplayItem.h"
#import "../LookinDisplayItemDetail.h"
#import "../LookinAttribute.h"
#import "../LookinAttributeModification.h"
#import "../LookinAttributesGroup.h"
#import "../LookinAttributesSection.h"
#import "../LookinAttrIdentifiers.h"
#import "../LookinAttrType.h"
#import "../LookinAutoLayoutConstraint.h"
#import "../LookinCustomAttrModification.h"
#import "../LookinCustomDisplayItemInfo.h"
#import "../LookinDashboardBlueprint.h"
#import "../LookinEventHandler.h"
#import "../LookinHierarchyFile.h"
#import "../LookinStaticAsyncUpdateTask.h"
#import "../LookinTuple.h"
#import "../LookinWeakContainer.h"
