import Foundation

@main struct IntegrationTests {
    static func main()async throws {
        let folder=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString,isDirectory:true)
        defer{try? FileManager.default.removeItem(at:folder)}
        let archive=ReflectionArchive(root:folder)
        try archive.save(["2026-10-26":"第一行\n第二行","../../escape":"bad","2026-10-27":""])
        let file=folder.appendingPathComponent("reflections/2026-10-26.md")
        let first=try String(contentsOf:file,encoding:.utf8);precondition(first.contains("第一行\n第二行"))
        precondition(!FileManager.default.fileExists(atPath:folder.appendingPathComponent("reflections/2026-10-27.md").path))
        let mode=try FileManager.default.attributesOfItem(atPath:file.path)[.posixPermissions] as! NSNumber
        precondition(mode.intValue==0o600)
        try archive.save(["2026-10-26":"修改后的复盘"])
        let edited=try String(contentsOf:file,encoding:.utf8);precondition(edited.contains("修改后的复盘"))
        try archive.save(["2026-10-26":""])
        let cleared=try String(contentsOf:file,encoding:.utf8);precondition(!cleared.contains("修改后的复盘"))
        print("通过：逐日归档、中文换行、覆盖编辑、清空一致性、私有权限、路径校验")
        let success=Data(#"{"ok":true,"identity":"user","data":{"items":[]}}"#.utf8)
        let data=try LarkCLI.decode(stdout:success,stderr:Data(),status:0)
        precondition(data["items"] as? [String] == [])
        do { _ = try LarkCLI.decode(stdout:Data(),stderr:Data(#"{"ok":false,"error":{"code":193104}}"#.utf8),status:1);preconditionFailure("必须保留 API 错误码供范围拆分") }catch let error as APIError{precondition(error.code==193104)}
        do{_ = try LarkCLI.decode(stdout:Data("malformed".utf8),stderr:Data(),status:0);preconditionFailure("不能把无效数据当作空日历")}catch{}
        do{_ = try LarkCLI.decode(stdout:Data("{}".utf8),stderr:Data(),status:0);preconditionFailure("缺失成功信封不能清空日历")}catch{}
        do{_ = try LarkCLI.decode(stdout:Data(#"{"ok":true,"identity":"bot","data":{}}"#.utf8),stderr:Data(),status:0,requireUser:true);preconditionFailure("不能把机器人空日历当成本人日历")}catch{}
        print("通过：CLI 成功信封、错误码、无效返回及身份保护")
        let script=folder.appendingPathComponent("fake-cli")
        let source="""
        #!/usr/bin/env python3
        import json,sys
        args=sys.argv[1:]
        if args[:2]==['auth','status']:
            print(json.dumps({'identities':{'user':{'available':True,'status':'ready','scope':['calendar:calendar:readonly','offline_access']}}}))
        else:
            assert '--as' in args and args[args.index('--as')+1]=='user'
            assert args[:3] in [['calendar','calendars','list'],['calendar','events','instance_view']]
            params=json.loads(args[args.index('--params')+1])
            if args[1]=='calendars':
                assert params['page_size']==1000
                print(json.dumps({'ok':True,'identity':'user','data':{'calendar_list':[],'has_more':False}}))
            else:
                assert params['calendar_id']=='calendar/id with spaces'
                print(json.dumps({'ok':True,'identity':'user','data':{'items':[]}}))
        """
        try source.write(to:script,atomically:true,encoding:.utf8);try FileManager.default.setAttributes([.posixPermissions:0o700],ofItemAtPath:script.path)
        let cli=LarkCLI(executable:script)
        let status=await cli.status();precondition(status["ready"] as? Bool == true)
        _ = try await cli.get("calendar/v4/calendars",["page_size":"1000"])
        _ = try await cli.get("calendar/v4/calendars/calendar%2Fid%20with%20spaces/events/instance_view",["start_time":"1","end_time":"2"])
        print("通过：独立 CLI 进程、用户身份、参数类型、含特殊字符的日历 ID")
    }
}
