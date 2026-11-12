import Foundation

@main struct FinanceVaultTests {
    @MainActor static func main()async throws {
        let folder=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString,isDirectory:true)
        defer{try? FileManager.default.removeItem(at:folder)}
        var pending:Data?
        func make()->FinanceVault{FinanceVault(root:folder,readPending:{pending},writePending:{pending=$0})}
        let original:[[String:Any]]=[["id":"f","title":"仅用于临时测试的账目","amountCents":12345,"type":"income","status":"pending"]]
        let vault=make();try vault.prepare(legacy:original)
        precondition(!vault.configured && !vault.isUnlocked && pending?.count==32)
        let path=folder.appendingPathComponent("finance-vault.json")
        let pendingData=try Data(contentsOf:path);precondition(!String(data:pendingData,encoding:.utf8)!.contains("临时测试"))
        do{_ = try vault.records();preconditionFailure("锁定前不得读取") }catch{}
        do{try vault.save([]);preconditionFailure("锁定时不得覆盖") }catch{}
        let restart=make();try restart.prepare(legacy:original)
        try restart.setPassword("test-only-password-one")
        precondition(restart.configured && restart.isUnlocked && pending==nil)
        let initialRows=try restart.records();precondition(initialRows.first?["amountCents"] as? Int == 12345)
        let cipher=try Data(contentsOf:path);precondition(cipher != pendingData)
        let mode=try FileManager.default.attributesOfItem(atPath:path.path)[.posixPermissions] as! NSNumber;precondition(mode.intValue==0o600)
        restart.lock();do{_ = try restart.records();preconditionFailure("锁定必须清除会话") }catch{}
        let again=make();try again.prepare(legacy:[])
        do{try again.unlock("wrong-test-password");preconditionFailure("错误密码必须拒绝") }catch{}
        precondition(!again.isUnlocked)
        try again.unlock("test-only-password-one");var edited=try again.records();edited[0]["amountCents"]=54321;try again.save(edited)
        try again.setPassword("test-only-password-two");again.lock()
        do{try again.unlock("test-only-password-one");preconditionFailure("旧密码不得继续解锁") }catch{}
        try again.unlock("test-only-password-two");let finalRows=try again.records();precondition(finalRows.first?["amountCents"] as? Int == 54321)
        let controller=AppController(storeURL:folder);controller.financeVault=again;controller.financeStorageReady=true
        let memos:[[String:Any]]=[["id":"memo","date":"2026-10-26","text":"测试备忘\n保留换行","archived":false]]
        try controller.saveState(["tasks":[["id":"task","title":"普通待办"]],"memos":memos,"finance":finalRows,"thoughts":[:]])
        let plain=try String(contentsOf:folder.appendingPathComponent("state.json"),encoding:.utf8);precondition(!plain.contains("临时测试") && !plain.contains("amountCents"))
        precondition(controller.publicState()["finance"]==nil)
        let saved=controller.read("state.json");precondition((saved["memos"] as? [[String:Any]])?.first?["text"] as? String == "测试备忘\n保留换行")
        let unlockedExport=try controller.exportSnapshot();precondition((unlockedExport["finance"] as? [[String:Any]])?.count==1);let excludedExport=try controller.exportSnapshot(includeFinance:false);precondition((excludedExport["finance"] as? [[String:Any]])?.isEmpty==true)
        again.lock();try again.prepare(legacy:[]);precondition(!again.isUnlocked)
        try controller.saveState(["tasks":[],"memos":memos,"finance":[],"thoughts":[:]])
        let lockedExport=try controller.exportSnapshot();precondition((lockedExport["finance"] as? [[String:Any]])?.isEmpty==true);precondition(lockedExport["financeIncluded"] as? Bool==false)
        precondition((lockedExport["memos"] as? [[String:Any]])?.first?["text"] as? String == "测试备忘\n保留换行")
        try again.unlock("test-only-password-two");let preserved=try again.records();precondition(preserved.first?["amountCents"] as? Int==54321);again.lock()
        do{_ = try await controller.handle("financeDelete",["id":"f","deleted":true]);preconditionFailure("原生删除接口在锁定时必须拒绝")}catch{}
        try again.unlock("test-only-password-two")
        let beforeDelete=try again.records(),cipherBeforeDelete=try Data(contentsOf:path)
        let deleted=try again.setDeleted(id:"f",deleted:true,at:Date(timeIntervalSince1970:123))
        precondition(deleted.first?["deletedAt"] as? Double==123000 && deleted.first?["amountCents"] as? Int==54321)
        let cipherAfterDelete=try Data(contentsOf:path);precondition(cipherAfterDelete != cipherBeforeDelete)
        again.lock()
        do{_ = try again.setDeleted(id:"f",deleted:false);preconditionFailure("锁定不得恢复或删除账目")}catch{}
        let deletionRestart=make();try deletionRestart.prepare(legacy:[]);try deletionRestart.unlock("test-only-password-two")
        let reopenedDeleted=try deletionRestart.records();precondition(reopenedDeleted.first?["deletedAt"] as? Double==123000)
        let restoredRows=try deletionRestart.setDeleted(id:"f",deleted:false)
        precondition(restoredRows.first?["deletedAt"]==nil && restoredRows.first?["status"] as? String==beforeDelete.first?["status"] as? String)
        let unchanged=try Data(contentsOf:path)
        do{_ = try deletionRestart.setDeleted(id:"missing",deleted:true);preconditionFailure("不存在的账目不得变更其他记录")}catch{}
        let afterMissing=try Data(contentsOf:path);precondition(afterMissing==unchanged)
        let savedCipher=folder.appendingPathComponent("saved-cipher")
        try FileManager.default.moveItem(at:path,to:savedCipher);try FileManager.default.createDirectory(at:path,withIntermediateDirectories:false)
        do{_ = try deletionRestart.setDeleted(id:"f",deleted:true);preconditionFailure("写入失败不得返回删除成功")}catch{}
        let failedRows=try deletionRestart.records();precondition(failedRows.first?["deletedAt"]==nil)
        try FileManager.default.removeItem(at:path);try FileManager.default.moveItem(at:savedCipher,to:path)
        print("通过：财务删除与恢复加密持久化、重开保留、锁定和无效记录拒绝、写入失败保留原账目")
        let progressRoot=folder.appendingPathComponent("progress",isDirectory:true)
        var progressKey:Data?
        func progressVault()->FinanceVault{FinanceVault(root:progressRoot,readPending:{progressKey},writePending:{progressKey=$0})}
        let progress=progressVault()
        let progressFixture:[[String:Any]]=[
            ["id":"work","type":"income","status":"negotiating","amountCents":10001,"date":"2026-10-01","notes":"原备注"],
            ["id":"expense","type":"expense","status":"pending","amountCents":100],
            ["id":"archive","type":"income","status":"negotiating","amountCents":100,"archived":true],
            ["id":"deleted","type":"income","status":"delivery","amountCents":100,"deletedAt":123],
            ["id":"settled","type":"income","status":"settled","amountCents":100],
            ["id":"legacy","type":"income","amountCents":100]]
        try progress.prepare(legacy:progressFixture);try progress.setPassword("progress-fixture-only")
        let progressPath=progressRoot.appendingPathComponent("finance-vault.json")
        let progressed=try progress.advance(id:"work",from:"negotiating",at:Date(timeIntervalSince1970:456))
        precondition(progressed[0]["status"] as? String=="delivery" && progressed[0]["updatedAt"] as? Double==456000)
        for index in 1..<progressFixture.count{precondition(NSDictionary(dictionary:progressed[index]).isEqual(to:progressFixture[index]))}
        let progressCipher=try Data(contentsOf:progressPath)
        for (id,from) in [("work","negotiating"),("work","pending"),("expense","pending"),("archive","negotiating"),("deleted","delivery"),("settled","settled"),("missing","pending")]{
            do{_ = try progress.advance(id:id,from:from);preconditionFailure("重复、越级或不允许推进的账目必须拒绝")}catch{}
        }
        let afterRejected=try Data(contentsOf:progressPath);precondition(afterRejected==progressCipher)
        let progressController=AppController(storeURL:progressRoot);progressController.financeVault=progress;progressController.financeStorageReady=true
        _ = try await progressController.handle("financeAdvance",["id":"work","from":"delivery"])
        let finished=try progress.advance(id:"work",from:"pending")
        precondition(finished[0]["status"] as? String=="settled" && finished[0]["amountCents"] as? Int==10001 && finished[0]["date"] as? String=="2026-10-01" && finished[0]["notes"] as? String=="原备注")
        let legacyFinished=try progress.advance(id:"legacy",from:"pending");precondition(legacyFinished[5]["status"] as? String=="settled")
        progress.lock();do{_ = try await progressController.handle("financeAdvance",["id":"work","from":"pending"]);preconditionFailure("锁定时原生推进接口必须拒绝")}catch{}
        let progressRestart=progressVault();try progressRestart.prepare(legacy:[]);try progressRestart.unlock("progress-fixture-only")
        var reopenedProgress=try progressRestart.records();precondition(reopenedProgress[0]["status"] as? String=="settled")
        reopenedProgress[0]["status"]="negotiating";try progressRestart.save(reopenedProgress)
        let progressBackup=progressRoot.appendingPathComponent("saved-cipher")
        try FileManager.default.moveItem(at:progressPath,to:progressBackup);try FileManager.default.createDirectory(at:progressPath,withIntermediateDirectories:false)
        do{_ = try progressRestart.advance(id:"work",from:"negotiating");preconditionFailure("写入失败不得返回推进成功")}catch{}
        let failedProgress=try progressRestart.records();precondition(failedProgress[0]["status"] as? String=="negotiating")
        try FileManager.default.removeItem(at:progressPath);try FileManager.default.moveItem(at:progressBackup,to:progressPath)
        print("通过：阶段逐步推进、重复及越级拒绝、非活动收入拒绝、原生入口锁定保护、加密重开与失败不改阶段")
        var json=try JSONSerialization.jsonObject(with:Data(contentsOf:path)) as! [String:Any]
        var bytes=Data(base64Encoded:json["box"] as! String)!;bytes[bytes.count-1] ^= 1;json["box"]=bytes.base64EncodedString();try JSONSerialization.data(withJSONObject:json).write(to:path)
        let tampered=make();try tampered.prepare(legacy:[])
        do{try tampered.unlock("test-only-password-two");preconditionFailure("篡改密文必须拒绝") }catch{}
        precondition(!tampered.isUnlocked)
        print("通过：财务迁移加密、私有权限、锁定读写拒绝、密码验证、重开恢复、修改密码、篡改校验、原生状态/导出脱敏与锁定保存防覆盖")
    }
}
