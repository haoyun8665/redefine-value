import Foundation

/// Fixed, read-only calendar commands. Tokens stay in the official CLI's credential store.
struct LarkCLI {
    let executable:URL
    static func locate()->LarkCLI? {
        let home=FileManager.default.homeDirectoryForCurrentUser
        let candidates=[home.appendingPathComponent(".npm-global/bin/lark-cli").path,home.appendingPathComponent(".local/bin/lark-cli").path,"/opt/homebrew/bin/lark-cli","/usr/local/bin/lark-cli"]+(ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator:":").map{String($0)+"/lark-cli"}
        return candidates.first(where:{FileManager.default.isExecutableFile(atPath:$0)}).map{LarkCLI(executable:URL(fileURLWithPath:$0))}
    }
    func run(_ arguments:[String],timeout:TimeInterval=45)async throws->[String:Any] {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos:.utility).async {
                do {
                    let process=Process(),out=Pipe(),err=Pipe()
                    process.executableURL=executable;process.arguments=arguments;process.standardOutput=out;process.standardError=err;process.standardInput=FileHandle.nullDevice
                    process.currentDirectoryURL=FileManager.default.homeDirectoryForCurrentUser
                    var env=ProcessInfo.processInfo.environment
                    env["PATH"]=executable.deletingLastPathComponent().path+":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:"+(env["PATH"] ?? "")
                    env["LARKSUITE_CLI_NO_UPDATE_NOTIFIER"]="1";env["LARKSUITE_CLI_NO_SKILLS_NOTIFIER"]="1"
                    process.environment=env
                    let group=DispatchGroup(),capture=CLICapture()
                    try process.run()
                    for (name,pipe) in [("out",out),("err",err)] {
                        group.enter();DispatchQueue.global(qos:.utility).async {
                            var bytes=Data()
                            while let chunk=try? pipe.fileHandleForReading.read(upToCount:65536),!chunk.isEmpty {
                                if bytes.count+chunk.count<=16*1024*1024{bytes.append(chunk)}else{capture.markOverflow();if process.isRunning{process.terminate()}}
                            }
                            capture.set(name,bytes);group.leave()
                        }
                    }
                    let finished=DispatchSemaphore(value:0)
                    process.terminationHandler={_ in finished.signal()}
                    if !process.isRunning{finished.signal()}
                    let timedOut=finished.wait(timeout:.now()+timeout) == .timedOut
                    if timedOut,process.isRunning{process.terminate()}
                    group.wait()
                    if timedOut{throw Failure("飞书 CLI 响应超时，请稍后重试。")}
                    if capture.overflow{throw Failure("飞书日历数据过大，本次保留上次数据。")}
                    let result=try Self.decode(stdout:capture.get("out"),stderr:capture.get("err"),status:process.terminationStatus,allowPlain:arguments.first=="auth",requireUser:arguments.contains("--as"))
                    continuation.resume(returning:result)
                }catch{continuation.resume(throwing:error)}
            }
        }
    }
    static func decode(stdout:Data,stderr:Data,status:Int32,allowPlain:Bool=false,requireUser:Bool=false)throws->[String:Any] {
        let out=(try? JSONSerialization.jsonObject(with:stdout)) as? [String:Any]
        let err=(try? JSONSerialization.jsonObject(with:stderr)) as? [String:Any]
        if status != 0 || out?["ok"] as? Bool == false {
            let detail=(err?["error"] ?? out?["error"]) as? [String:Any] ?? [:]
            if let code=(detail["code"] as? NSNumber)?.intValue{throw APIError(code:code)}
            if ["authentication","permission"].contains(detail["type"] as? String ?? ""){throw Failure("飞书 CLI 尚未获得有效的日历授权，请在设置中重新连接。")}
            throw Failure("飞书 CLI 调用失败，请检查网络或重新连接飞书。")
        }
        guard let json=out else{throw Failure("无法读取飞书 CLI 的返回数据。")}
        if json["ok"] as? Bool == true {
            if requireUser,json["identity"] as? String != "user"{throw Failure("飞书 CLI 没有使用本人身份，本次同步未更新。请重新连接。")}
            guard let data=json["data"] as? [String:Any] else{throw Failure("飞书 CLI 未返回完整日历数据。")};return data}
        // Auth subcommands intentionally return their own top-level JSON contract.
        guard allowPlain else{throw Failure("飞书 CLI 未返回成功信封，本次保留上次日历。")};return json
    }
    func status()async->[String:Any] {
        do {
            let data=try await run(["auth","status","--json"],timeout:15)
            let user=(data["identities"] as? [String:Any])?["user"] as? [String:Any] ?? [:]
            let scopeValue=user["scope"] ?? user["scopes"]
            let scopes=Set((scopeValue as? [String]) ?? (scopeValue as? String ?? "").split(whereSeparator:{$0==" " || $0==","}).map(String.init))
            let full=scopes.contains("calendar:calendar:readonly") || scopes.contains("calendar:calendar")
            let calendar=full || !scopes.isDisjoint(with:["calendar:calendar.calendar:readonly","calendar:calendar:read"])
            let events=full || scopes.contains("calendar:calendar.event:read")
            let authenticated=user["available"] as? Bool == true
            return ["installed":true,"authenticated":authenticated,"ready":authenticated && calendar && events,"status":user["status"] as? String ?? "missing"]
        }catch{return ["installed":true,"ready":false,"status":"unavailable"]}
    }
    func get(_ path:String,_ query:[String:String])async throws->[String:Any] {
        var args:[String],params:[String:Any]=query
        if path == "calendar/v4/calendars" {args=["calendar","calendars","list"];params["page_size"]=Int(query["page_size"] ?? "1000") ?? 1000}
        else {
            let parts=path.components(separatedBy:"/")
            guard parts.count==6,parts[4]=="events",parts[5]=="instance_view",let id=parts[3].removingPercentEncoding else{throw Failure("不支持的飞书 CLI 请求。")}
            args=["calendar","events","instance_view"];params["calendar_id"]=id
        }
        let json=String(data:try JSONSerialization.data(withJSONObject:params),encoding:.utf8)!
        return try await run(args+["--params",json,"--as","user","--format","json"])
    }
}

private final class CLICapture:@unchecked Sendable {
    private let lock=NSLock();private var values:[String:Data]=[:];private var exceeded=false
    func set(_ key:String,_ value:Data){lock.lock();defer{lock.unlock()};values[key]=value}
    func get(_ key:String)->Data{lock.lock();defer{lock.unlock()};return values[key] ?? Data()}
    func markOverflow(){lock.lock();defer{lock.unlock()};exceeded=true}
    var overflow:Bool{lock.lock();defer{lock.unlock()};return exceeded}
}

struct ReflectionArchive {
    let root:URL
    func save(_ thoughts:[String:Any])throws {
        let folder=root.appendingPathComponent("reflections",isDirectory:true)
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        for (date,value) in thoughts {
            guard date.range(of:"^\\d{4}-\\d{2}-\\d{2}$",options:.regularExpression) != nil,let text=value as? String else{continue}
            let url=folder.appendingPathComponent(date+".md")
            // Clearing an existing day updates its archive too; empty new days make no file.
            if text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && !FileManager.default.fileExists(atPath:url.path){continue}
            let bytes=Data(("# "+date+" · 每日复盘\n\n"+text+"\n").utf8)
            if (try? Data(contentsOf:url)) != bytes{try bytes.write(to:url,options:.atomic)}
            try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:url.path)
        }
    }
}
