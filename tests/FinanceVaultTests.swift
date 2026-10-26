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
        var json=try JSONSerialization.jsonObject(with:Data(contentsOf:path)) as! [String:Any]
        var bytes=Data(base64Encoded:json["box"] as! String)!;bytes[bytes.count-1] ^= 1;json["box"]=bytes.base64EncodedString();try JSONSerialization.data(withJSONObject:json).write(to:path)
        let tampered=make();try tampered.prepare(legacy:[])
        do{try tampered.unlock("test-only-password-two");preconditionFailure("篡改密文必须拒绝") }catch{}
        precondition(!tampered.isUnlocked)
        print("通过：财务迁移加密、私有权限、锁定读写拒绝、密码验证、重开恢复、修改密码、篡改校验、原生状态/导出脱敏与锁定保存防覆盖")
    }
}
