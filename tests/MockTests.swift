import Foundation

final class MockProtocol:URLProtocol {
    static var phase=1
    static var paged=false
    static var split=false
    override class func canInit(with request:URLRequest)->Bool{true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
    override func startLoading(){
        let url=request.url!,query=URLComponents(url:url,resolvingAgainstBaseURL:false)!.queryItems ?? []
        var json:[String:Any]
        if url.path.hasSuffix("/calendars") {
            if query.contains(where:{$0.name=="page_token"}){Self.paged=true;json=["code":0,"data":["calendar_list":[["calendar_id":"external","summary":"外接日历","type":"google","role":"owner"]],"has_more":false]]}
            else{json=["code":0,"data":["calendar_list":[["calendar_id":"work","summary":"工作","type":"primary","role":"owner","color":5213036]],"has_more":true,"page_token":"next-page"]]}
        }else{
            precondition(!url.path.contains("external"),"不应请求不支持的日历")
            let start=Int(query.first(where:{$0.name=="start_time"})!.value!)!,end=Int(query.first(where:{$0.name=="end_time"})!.value!)!
            if end-start>16*86400{Self.split=true;json=["code":193104]}
            else{
                func event(_ id:String,_ title:String,_ status:String="confirmed")->[String:Any]{["event_id":id,"summary":title,"status":status,"start_time":["timestamp":"1792886400"],"end_time":["timestamp":"1792890000"]]}
                let list=Self.phase==1 ? [event("old","原安排"),event("edit","修改前"),event("cancelled","已取消","cancelled")] : [event("edit","修改后"),event("new","新增安排"),event("old","已删除","cancelled")]
                json=["code":0,"data":["items":list]]
            }
        }
        let data=try! JSONSerialization.data(withJSONObject:json)
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:url,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:data);client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading(){}
}

@main struct MockTests {
    @MainActor static func main()async throws {
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[MockProtocol.self]
        let client=FeishuClient(session:URLSession(configuration:config))
        client.credential=Credential(appId:"cli_fixture",secret:"test-fixture",access:"fixture",refresh:"",expires:Date().timeIntervalSince1970+7200)
        let first=try await client.sync(start:1790784000,end:1793462400)
        let a=first["events"] as! [[String:Any]]
        precondition(a.count==2,"必须去重拆分边界实例，并过滤取消的日程")
        precondition(MockProtocol.paged&&MockProtocol.split,"必须遍历日历分页、处理实例上限")
        MockProtocol.phase=2
        let second=try await client.sync(start:1790784000,end:1793462400)
        let b=(second["events"] as! [[String:Any]]).map{$0["event"] as! [String:Any]}
        precondition(b.count == 2 && !b.contains(where:{$0["event_id"] as? String=="old"}),"删除日程必须从新快照移除")
        precondition(b.contains(where:{$0["summary"] as? String=="修改后"})&&b.contains(where:{$0["event_id"] as? String=="new"}),"新增修改必须进入快照")
        print("通过：模拟飞书分页、上限拆分、边界去重、新增、修改、取消与删除")
        let server=CallbackServer();var received=""
        try server.start(state:"fixture-state"){result in received=(try? result.get()) ?? "error"}
        let invalid=URL(string:CallbackServer.redirect+"?state=wrong&code=fixture-code")!
        let (_,rejected)=try await URLSession.shared.data(from:invalid)
        precondition((rejected as! HTTPURLResponse).statusCode==400&&received.isEmpty,"错误state不能被接受或消耗授权会话")
        let valid=URL(string:CallbackServer.redirect+"?state=fixture-state&code=fixture-code")!
        let (_,accepted)=try await URLSession.shared.data(from:valid)
        precondition((accepted as! HTTPURLResponse).statusCode==200&&received=="fixture-code","正确state应完成本机授权回调")
        print("通过：本机OAuth回调与state校验；未调用真实飞书账号")
    }
}
