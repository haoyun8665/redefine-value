import Foundation

@main struct ExportTests {
    @MainActor static func main()throws {
        let fm=FileManager.default,folder=fm.temporaryDirectory.appendingPathComponent("export-tests-"+UUID().uuidString,isDirectory:true)
        try fm.createDirectory(at:folder,withIntermediateDirectories:true)
        defer{try? fm.removeItem(at:folder)}
        var pending:Data?
        let root=folder.appendingPathComponent("store"),vault=FinanceVault(root:root,readPending:{pending},writePending:{pending=$0})
        try vault.prepare(legacy:[])
        let controller=AppController(storeURL:root);controller.financeVault=vault
        do{_ = try controller.exportAllSnapshot(calendarEvents:[]);preconditionFailure("存储未准备好时不得导出") }catch{}
        controller.financeStorageReady=true
        let empty=try controller.exportAllSnapshot(calendarEvents:[])
        precondition(empty["financeIncluded"] as? Bool==true && !vault.configured && !vault.isUnlocked)

        var legacyKey:Data?
        let legacy=FinanceVault(root:folder.appendingPathComponent("legacy"),readPending:{legacyKey},writePending:{legacyKey=$0})
        try legacy.prepare(legacy:[["id":"legacy","title":"旧账目","amountCents":500]])
        controller.financeVault=legacy
        do{_ = try controller.exportAllSnapshot(calendarEvents:[]);preconditionFailure("旧账目未设密时不得忽略财务导出") }catch{}
        controller.financeVault=vault
        try vault.setPassword("export-fixture-only")
        let finance:[[String:Any]]=[
            ["id":"pending","title":"待结算示例","type":"income","status":"pending","amountCents":12345,"party":"演示客户","date":"2026-10-30","notes":"保留备注\n第二行"],
            ["id":"settled","title":"已结算示例","type":"income","status":"settled","amountCents":10001,"archived":true,"date":"2026-09-30"],
            ["id":"deleted","title":"最近删除示例","type":"income","status":"pending","amountCents":200,"deletedAt":1793318400000,"date":"2026-10-30"]]
        let state:[String:Any]=[
            "tasks":[["id":"t","title":"含时间待办","date":"2026-10-30","time":"09:30","notes":"旧备注","done":false]],
            "projects":[["id":"p","title":"归档项目","date":"2026-10-29","nextStep":"项目进度","archived":true]],
            "business":[["id":"b","title":"商务示例","date":"2026-10-28","subject":"客户示例","notes":"商务备注"]],
            "development":[["id":"d","title":"开发示例","date":"2026-10-31","startTime":"10:00","endTime":"11:00"]],
            "thoughts":["2026-10-30":"今日复盘\n<script>原文保留</script>","2026-10-29":"历史复盘"],
            "reviewSubmitted":["2026-10-30":1793322000000],
            "reviews":[["id":"review-one","date":"2026-10-30","text":"同日第一条新增复盘","submittedAt":1793322100000],["id":"review-two","date":"2026-10-30","text":"同日第二条新增复盘","submittedAt":1793322200000]],
            "memos":[["id":"m","date":"2026-10-20","text":"备忘第一行\n第二行","archived":true]],
            "finance":finance,"hiddenCalendars":["hidden"],"prompt":"自定义提醒"]
        try controller.saveState(state)
        let event:[String:Any]=["id":"hidden:event","calendarId":"hidden","calendar":"隐藏日历","title":"飞书示例","start":1793318400000,"end":1793322000000,"allDay":false,"timezone":"Asia/Shanghai","description":"日程描述\n第二行","link":"https://example.com/event","meeting":"https://example.com/meeting","location":"会议室"]
        controller.cache=["2026-10":["syncedAt":123,"events":[event]]]
        vault.lock()
        do{_ = try controller.exportAllSnapshot(calendarEvents:[event]);preconditionFailure("已设置密码但锁定时必须拒绝") }catch{}
        try vault.unlock("export-fixture-only")
        let snapshot=try controller.exportAllSnapshot(calendarEvents:[event])
        precondition(snapshot["financeIncluded"] as? Bool==true)
        let destination=folder.appendingPathComponent("全部内容.zip")
        try WorkspaceExport.write(snapshot,to:destination)
        let archiveMode=try fm.attributesOfItem(atPath:destination.path)[.posixPermissions] as! NSNumber;precondition(archiveMode.intValue==0o600)
        let extracted=folder.appendingPathComponent("extracted"),process=Process()
        process.executableURL=URL(fileURLWithPath:"/usr/bin/ditto");process.arguments=["-x","-k",destination.path,extracted.path]
        try process.run();process.waitUntilExit();precondition(process.terminationStatus==0)
        let contents=extracted.appendingPathComponent("重新定义价值-全部内容")
        let files=try fm.contentsOfDirectory(atPath:contents.path);precondition(Set(files)==Set(["完整备份.json","全部内容.md","导出说明.txt"]))
        for file in files{let mode=try fm.attributesOfItem(atPath:contents.appendingPathComponent(file).path)[.posixPermissions] as! NSNumber;precondition(mode.intValue==0o600)}
        let jsonData=try Data(contentsOf:contents.appendingPathComponent("完整备份.json")),json=try JSONSerialization.jsonObject(with:jsonData) as! [String:Any]
        for key in ["tasks","projects","business","development","thoughts","reviewSubmitted","reviews","memos","finance","hiddenCalendars","prompt"]{precondition(NSDictionary(dictionary:[key:json[key]!]).isEqual(to:[key:state[key]!]))}
        let saved=controller.read("state.json");precondition((saved["reviewSubmitted"] as? [String:Any])?["2026-10-30"] as? Int==1793322000000)
        precondition((json["calendarEvents"] as? [[String:Any]])?.first?["id"] as? String=="hidden:event")
        precondition((json["calendarCache"] as? [String:Any])?["2026-10"] != nil)
        let jsonText=String(data:jsonData,encoding:.utf8)!;precondition(!jsonText.contains("export-fixture-only") && !jsonText.contains("access_token") && !jsonText.contains("finance-vault"))
        let report=try String(contentsOf:contents.appendingPathComponent("全部内容.md"),encoding:.utf8)
        precondition(report.contains("## 每日复盘（4）") && report.contains("同日第一条新增复盘") && report.contains("同日第二条新增复盘"))
        precondition(report.contains("最近删除示例") && report.contains("删除状态：最近删除（不计入金额汇总，可在应用内恢复）"))
        for title in ["待办","项目","商务","开发","每日复盘","财务","备忘","已同步飞书日程"]{precondition(report.contains("## "+title+"（"))}
        for text in ["09:30","123.45","100.01","已结算","已归档","项目进度","商务备注","    备忘第一行\n    第二行","    <script>原文保留</script>","https://example.com/event","https://example.com/meeting","日程描述"]{precondition(report.contains(text),text)}
        precondition(report.range(of:"今日复盘")!.lowerBound < report.range(of:"历史复盘")!.lowerBound)
        // Replacing a previously selected export must be complete and leave no staging files.
        var updated=snapshot;updated["prompt"]="第二次导出";try WorkspaceExport.write(updated,to:destination)
        let remaining=try fm.contentsOfDirectory(atPath:folder.path);precondition(!remaining.contains{$0.hasPrefix(".redefine-export-")})
        let rejected=folder.appendingPathComponent("partial.zip")
        do{try WorkspaceExport.write(["financeIncluded":false],to:rejected);preconditionFailure("不完整快照不得伪装成全部导出") }catch{}
        precondition(!fm.fileExists(atPath:rejected.path))
        let restarted=FinanceVault(root:root,readPending:{pending},writePending:{pending=$0});try restarted.prepare(legacy:[]);try restarted.unlock("export-fixture-only")
        let restored=try restarted.records();precondition(restored[1]["status"] as? String=="settled" && restored[1]["amountCents"] as? Int==10001)
        precondition(restored[2]["deletedAt"] as? Int==1793318400000)
        let plain=try String(contentsOf:root.appendingPathComponent("state.json"),encoding:.utf8);precondition(!plain.contains("amountCents"))
        print("通过：完整导出覆盖全部模块、归档、复盘、日程和设置；财务锁定拒绝/空保险箱兼容；ZIP 内容、私有权限、覆盖导出及加密结算状态保留")
    }
}
