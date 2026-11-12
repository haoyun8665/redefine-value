import Foundation

/// Local export contains user records, never credentials or encryption keys.
struct WorkspaceExport {
    static func write(_ snapshot:[String:Any],to destination:URL)throws {
        guard snapshot["financeIncluded"] as? Bool == true else{throw Failure("财务尚未解锁，未导出不完整的备份。")}
        let fm=FileManager.default,temporary=fm.temporaryDirectory.appendingPathComponent("redefine-export-"+UUID().uuidString,isDirectory:true)
        try fm.createDirectory(at:temporary,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        defer{try? fm.removeItem(at:temporary)}
        let folder=temporary.appendingPathComponent("重新定义价值-全部内容",isDirectory:true)
        try fm.createDirectory(at:folder,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        func file(_ name:String,_ data:Data)throws {
            let url=folder.appendingPathComponent(name)
            guard fm.createFile(atPath:url.path,contents:data,attributes:[.posixPermissions:0o600]) else{throw Failure("无法写入导出文档。")}
        }
        try file("完整备份.json",JSONSerialization.data(withJSONObject:snapshot,options:[.prettyPrinted,.sortedKeys]))
        try file("全部内容.md",Data(report(snapshot).utf8))
        try file("导出说明.txt",Data("完整备份.json：全部模块、归档记录、复盘、设置及已同步飞书日程数据。\n全部内容.md：可直接阅读的全部记录。\n财务已包含在导出文件中。飞书密码、Token、财务密码和加密密钥不会导出。\n日程仅包含本机已同步的数据；此文件不提供自动恢复功能。\n".utf8))
        let archive=temporary.appendingPathComponent("全部内容.zip"),process=Process()
        process.executableURL=URL(fileURLWithPath:"/usr/bin/ditto")
        process.arguments=["-c","-k","--keepParent",folder.path,archive.path]
        process.standardOutput=FileHandle.nullDevice;process.standardError=FileHandle.nullDevice
        try process.run();process.waitUntilExit()
        guard process.terminationStatus==0,fm.fileExists(atPath:archive.path) else{throw Failure("导出压缩包生成失败，原记录未更改。")}
        try fm.setAttributes([.posixPermissions:0o600],ofItemAtPath:archive.path)
        let staged=destination.deletingLastPathComponent().appendingPathComponent(".redefine-export-"+UUID().uuidString+".zip")
        defer{try? fm.removeItem(at:staged)}
        try fm.copyItem(at:archive,to:staged)
        if fm.fileExists(atPath:destination.path){_ = try fm.replaceItemAt(destination,withItemAt:staged,options:.usingNewMetadataOnly)}
        else{try fm.moveItem(at:staged,to:destination)}
        try fm.setAttributes([.posixPermissions:0o600],ofItemAtPath:destination.path)
    }
    static func report(_ snapshot:[String:Any])->String {
        func text(_ value:Any?)->String {
            if let s=value as? String{return s};if let n=value as? NSNumber{return n.stringValue};return ""
        }
        func inline(_ value:Any?)->String {
            text(value).replacingOccurrences(of:"&",with:"&amp;").replacingOccurrences(of:"<",with:"&lt;").replacingOccurrences(of:">",with:"&gt;")
                .replacingOccurrences(of:"\\",with:"\\\\").replacingOccurrences(of:"`",with:"\\`").replacingOccurrences(of:"*",with:"\\*").replacingOccurrences(of:"_",with:"\\_").replacingOccurrences(of:"[",with:"\\[").replacingOccurrences(of:"]",with:"\\]").replacingOccurrences(of:"\n",with:" ")
        }
        var output="# 重新定义价值 · 全部内容\n\n导出时间："+inline(snapshot["exportedAt"])+"\n\n"
        let income=["negotiating":"待接洽","delivery":"待交付","pending":"待结算","settled":"已结算"]
        func section(_ title:String,_ rows:[[String:Any]],_ describe:([String:Any])->[(String,Any?)]) {
            output+="## \(title)（\(rows.count)）\n\n"
            if rows.isEmpty{output+="暂无记录。\n\n";return}
            for row in rows {
                output+="### "+inline(row["title"] ?? row["name"] ?? row["date"] ?? "记录")+"\n\n"
                for (label,value) in describe(row){let content=text(value);if !content.isEmpty{output+="- \(label)："+inline(value)+"\n"}}
                for (key,label) in [("notes","备注"),("nextStep","进度备注"),("text","正文"),("description","日程备注")] {
                    let content=text(row[key]);if !content.isEmpty{output+="\n\(label)：\n\n"+content.components(separatedBy:.newlines).map{"    "+$0}.joined(separator:"\n")+"\n"}
                }
                output+="\n"
            }
        }
        func rows(_ key:String)->[[String:Any]]{snapshot[key] as? [[String:Any]] ?? []}
        func archived(_ row:[String:Any])->String{row["archived"] as? Bool == true ? "已归档":"未归档"}
        section("待办",rows("tasks")){[("日期",$0["date"]),("时间",$0["time"]),("状态",$0["done"] as? Bool == true ? "已完成":"未完成"),("完成日期",$0["completedOn"]),("归档",archived($0))]}
        section("项目",rows("projects")){[("日期",$0["date"]),("状态",($0["status"] as? String=="done" || ($0["progress"] as? Int ?? 0)>=100) ? "已完成":text($0["status"])),("进度",$0["progress"]),("归档",archived($0))]}
        for (key,title) in [("business","商务"),("development","开发")] {
            section(title,rows(key)){[("日期",$0["date"]),("开始时间",$0["startTime"]),("结束时间",$0["endTime"]),("客户 / 项目",$0["subject"]),("状态",$0["status"]),("归档",archived($0))]}
        }
        let thoughts=snapshot["thoughts"] as? [String:Any] ?? [:],submitted=snapshot["reviewSubmitted"] as? [String:Any] ?? [:]
        let legacyReviews=thoughts.keys.compactMap{date->[String:Any]? in
            guard let body=thoughts[date] as? String,!body.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else{return nil}
            return ["date":date,"text":body,"legacy":true,"submittedAt":submitted[date] ?? 0]
        }
        let addedReviews=rows("reviews").filter{!(($0["text"] as? String ?? "").trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)}
        let reviewRows=(legacyReviews+addedReviews).sorted{a,b in
            let first=a["date"] as? String ?? "",second=b["date"] as? String ?? ""
            if first != second{return first>second}
            let firstStamp=(a["updatedAt"] as? NSNumber)?.doubleValue ?? (a["submittedAt"] as? NSNumber)?.doubleValue ?? 0
            let secondStamp=(b["updatedAt"] as? NSNumber)?.doubleValue ?? (b["submittedAt"] as? NSNumber)?.doubleValue ?? 0
            return firstStamp>secondStamp
        }
        section("每日复盘",reviewRows){row in
            let stamp=(row["submittedAt"] as? NSNumber)?.doubleValue ?? 0
            return [("日期",row["date"]),("状态",stamp>0 ? "已提交":row["legacy"] as? Bool == true ? "已保存":"草稿")]
        }
        section("财务",rows("finance")){row in
            let cents=(row["amountCents"] as? NSNumber)?.int64Value ?? 0,amount="\(cents/100)."+String(format:"%02lld",abs(cents%100))
            let isIncome=row["type"] as? String=="income",status=text(row["status"])
            let deleted=((row["deletedAt"] as? NSNumber)?.doubleValue ?? 0)>0
            return [("日期",row["date"]),("收支",isIncome ? "收入":"支出"),("金额（元）",amount),("阶段",isIncome ? income[status] ?? "待结算":status=="settled" ? "已结清":"待付款"),("往来方",row["party"]),("归档",archived(row)),("删除状态",deleted ? "最近删除（不计入金额汇总，可在应用内恢复）":"未删除")]
        }
        section("备忘",rows("memos")){[("日期",$0["date"]),("归档",archived($0))]}
        let formatter=DateFormatter();formatter.locale=Locale(identifier:"zh_CN");formatter.dateFormat="yyyy-MM-dd HH:mm"
        func eventTime(_ value:Any?)->String{guard let stamp=value as? NSNumber else{return text(value)};return formatter.string(from:Date(timeIntervalSince1970:stamp.doubleValue/1000))}
        section("已同步飞书日程",rows("calendarEvents")){[("开始",eventTime($0["start"])),("结束",eventTime($0["end"])),("全天",$0["allDay"] as? Bool == true ? "是（结束日期不含当日）":"否"),("时区",$0["timezone"]),("日历",$0["calendar"]),("地点",$0["location"]),("链接",$0["link"]),("会议链接",$0["meeting"])]}
        return output
    }
}
