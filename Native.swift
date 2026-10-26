import AppKit
import WebKit
import Security
import CryptoKit
import Network
import UserNotifications

struct Failure: LocalizedError { let message: String; var errorDescription: String? { message }; init(_ s: String) {message=s} }
struct APIError: LocalizedError { let code: Int; var errorDescription: String? {
    switch code {
    case 20002: return "App Secret 不正确，请重新填写。"
    case 20009,20010,20069: return "请确认飞书应用已发布，且你在应用可用范围内。"
    case 20026,20037,20064,20073: return "飞书授权已失效，请重新连接。"
    case 20027,99991672,99991679: return "缺少日历权限，请开通用户身份的日历只读与 offline_access 权限，发布后重新授权。"
    case 190004,190005,190010: return "飞书请求较多，稍后会自动重试。"
    case 193104: return "日程数量较多，正在缩小查询范围。"
    default: return "飞书返回错误 \(code)，请核对应用权限，或稍后重试。"
    }
} }

enum Vault {
    static let service="local.zaichang.desktop"
    static func read(_ key:String)->Data? {
        let q:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key,kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne]
        var result:CFTypeRef?; guard SecItemCopyMatching(q as CFDictionary,&result)==errSecSuccess else{return nil};return result as? Data
    }
    static func put(_ key:String,_ data:Data)throws {
        let q:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key]
        let update=SecItemUpdate(q as CFDictionary,[kSecValueData as String:data] as CFDictionary)
        if update==errSecItemNotFound {
            var item=q;item[kSecValueData as String]=data;item[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(item as CFDictionary,nil)==errSecSuccess else{throw Failure("无法保存到本机钥匙串。")}
        }else if update != errSecSuccess {throw Failure("无法更新本机钥匙串。")}
    }
    static func remove(_ key:String) {SecItemDelete([kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key] as CFDictionary)}
}

struct Credential:Codable {var appId:String;var secret:String;var access:String;var refresh:String;var expires:Double}

@MainActor final class FeishuClient {
    var credential:Credential? = Vault.read("feishu").flatMap{try? JSONDecoder().decode(Credential.self,from:$0)}
    var sessionVersion=0
    var cli:LarkCLI?
    let session:URLSession
    init(session:URLSession?=nil){self.session=session ?? {let c=URLSessionConfiguration.ephemeral;c.timeoutIntervalForRequest=25;return URLSession(configuration:c)}()}
    var connected:Bool {cli != nil || credential?.access.isEmpty == false}
    func store(_ c:Credential)throws {try Vault.put("feishu",JSONEncoder().encode(c));credential=c}
    func disconnect(){sessionVersion += 1;cli=nil;credential=nil;Vault.remove("feishu")}
    func postToken(_ body:[String:String])async throws->[String:Any] {
        var r=URLRequest(url:URL(string:"https://accounts.feishu.cn/oauth/v3/token")!);r.httpMethod="POST";r.setValue("application/json; charset=utf-8",forHTTPHeaderField:"Content-Type");r.httpBody=try JSONSerialization.data(withJSONObject:body)
        return try await send(r)
    }
    func send(_ r:URLRequest)async throws->[String:Any] {
        let (data,response)=try await session.data(for:r)
        guard let http=response as? HTTPURLResponse,let json=try JSONSerialization.jsonObject(with:data) as? [String:Any] else{throw Failure("飞书返回了无法识别的数据。")}
        let code=(json["code"] as? NSNumber)?.intValue ?? (http.statusCode==200 && json["error"]==nil ? 0 : http.statusCode)
        guard code==0,(200..<300).contains(http.statusCode) else{throw APIError(code:code)}
        return json
    }
    func exchange(code:String,verifier:String,appId:String,secret:String)async throws {
        sessionVersion += 1;let version=sessionVersion
        let j=try await postToken(["grant_type":"authorization_code","client_id":appId,"client_secret":secret,"code":code,"redirect_uri":CallbackServer.redirect,"code_verifier":verifier])
        guard sessionVersion==version else{throw Failure("连接已取消。")}
        guard let access=j["access_token"] as? String,let lifetime=j["expires_in"] as? Double else{throw Failure("飞书没有返回有效授权。")}
        try store(Credential(appId:appId,secret:secret,access:access,refresh:j["refresh_token"] as? String ?? "",expires:Date().timeIntervalSince1970+lifetime))
    }
    func token()async throws->String {
        guard var c=credential else{throw Failure("请先连接飞书。")}
        if c.expires > Date().timeIntervalSince1970+120{return c.access}
        guard !c.refresh.isEmpty else{throw Failure("授权已到期，请重新连接飞书并允许离线访问。")}
        let version=sessionVersion
        let j=try await postToken(["grant_type":"refresh_token","client_id":c.appId,"client_secret":c.secret,"refresh_token":c.refresh])
        guard sessionVersion==version else{throw Failure("连接已取消。")}
        guard let access=j["access_token"] as? String,let lifetime=j["expires_in"] as? Double else{throw Failure("刷新飞书授权失败，请重新连接。")}
        c.access=access;c.expires=Date().timeIntervalSince1970+lifetime
        if let refresh=j["refresh_token"] as? String {c.refresh=refresh}
        try store(c);return c.access
    }
    func get(_ path:String,_ query:[String:String],_ token:String)async throws->[String:Any] {
        if let cli=cli{return try await cli.get(path,query)}
        var u=URLComponents(string:"https://open.feishu.cn/open-apis/"+path)!;u.queryItems=query.map{URLQueryItem(name:$0.key,value:$0.value)}
        var r=URLRequest(url:u.url!);r.setValue("Bearer "+token,forHTTPHeaderField:"Authorization")
        return try await send(r)["data"] as? [String:Any] ?? [:]
    }
    func instances(_ id:String,_ start:Int,_ end:Int,_ access:String,depth:Int=0)async throws->[[String:Any]] {
        let encoded=id.addingPercentEncoding(withAllowedCharacters:.alphanumerics)!
        do{
            let j=try await get("calendar/v4/calendars/\(encoded)/events/instance_view",["start_time":String(start),"end_time":String(end)],access)
            let items=j["items"] as? [[String:Any]] ?? []
            if items.count>=999 {throw APIError(code:193104)}
            return items
        }catch let e as APIError where e.code==193104 {
            guard depth<18,end-start>60 else{throw Failure("单分钟内日程过多，无法完整同步；保留上次数据。")}
            let mid=start+(end-start)/2
            let left=try await instances(id,start,mid,access,depth:depth+1)
            let right=try await instances(id,mid,end,access,depth:depth+1)
            var unique:[String:[String:Any]]=[:]
            for event in left+right {if let key=event["event_id"] as? String{unique[key]=event}}
            return Array(unique.values)
        }
    }
    func sync(start:Int,end:Int)async throws->[String:Any] {
        guard start<end,end-start<40*86400 else{throw Failure("每次同步的范围必须小于 40 天。")}
        let version=sessionVersion,access=cli != nil ? "" : try await token()
        var calendars:[[String:Any]]=[],page="",seen=Set<String>()
        repeat{
            var q=["page_size":"1000"];if !page.isEmpty{q["page_token"]=page}
            let j=try await get("calendar/v4/calendars",q,access)
            calendars += (j["calendar_list"] as? [[String:Any]] ?? []).filter{($0["is_deleted"] as? Bool) != true}
            if j["has_more"] as? Bool == true {
                guard let next=j["page_token"] as? String,!next.isEmpty,!seen.contains(next) else{throw Failure("飞书日历分页异常，本次同步未完成。")};seen.insert(next);page=next
            }else{page=""}
        }while !page.isEmpty
        var events:[[String:Any]]=[]
        for cal in calendars where ["primary","shared"].contains(cal["type"] as? String ?? "") && ["owner","writer","reader"].contains(cal["role"] as? String ?? "") {
            guard sessionVersion==version else{throw Failure("连接已取消。")}
            let entries=try await instances(cal["calendar_id"] as? String ?? "",start,end,access)
            for e in entries where e["status"] as? String != "cancelled" {events.append(["event":e,"calendar":cal])}
        }
        guard sessionVersion==version else{throw Failure("连接已取消。")}
        return ["events":events,"calendars":calendars]
    }
}

@MainActor final class CallbackServer {
    static let redirect="http://127.0.0.1:41863/callback"
    var listener:NWListener?;var timeout:DispatchWorkItem?;var onResult:((Result<String,Error>)->Void)?
    func stop(){timeout?.cancel();timeout=nil;listener?.cancel();listener=nil;onResult=nil}
    func start(state:String,result:@escaping(Result<String,Error>)->Void)throws {
        stop();onResult=result
        let p=NWParameters.tcp;p.requiredLocalEndpoint = .hostPort(host:"127.0.0.1",port:41863)
        let l=try NWListener(using:p);listener=l
        l.stateUpdateHandler={ [weak self] s in if case .failed = s {Task{@MainActor in self?.finish(.failure(Failure("本机授权回调端口被占用，请稍后重新连接。")))}} }
        l.newConnectionHandler={ [weak self] c in Task{@MainActor in self?.receive(c,state:state)} }
        l.start(queue:.main)
        let work=DispatchWorkItem{[weak self] in self?.finish(.failure(Failure("授权已超时，请重新点击连接飞书。")))};timeout=work;DispatchQueue.main.asyncAfter(deadline:.now()+240,execute:work)
    }
    func finish(_ result:Result<String,Error>){let f=onResult;stop();f?(result)}
    func receive(_ c:NWConnection,state:String,buffer:Data=Data(),started:Bool=false){
        if !started{c.start(queue:.main)}
        c.receive(minimumIncompleteLength:1,maximumLength:16384){ [weak self] data,_,complete,error in
            Task{@MainActor in
                var all=buffer;if let data=data{all.append(data)}
                guard all.count<=16384,error==nil else{c.cancel();return}
                guard let request=String(data:all,encoding:.utf8) else{c.cancel();return}
                guard request.contains("\r\n\r\n") else{if !complete{self?.receive(c,state:state,buffer:all,started:true)}else{c.cancel()};return}
                let parts=request.components(separatedBy:"\r\n").first?.components(separatedBy:" ") ?? []
                guard parts.count>=2,parts[0]=="GET",let u=URLComponents(string:"http://127.0.0.1"+parts[1]),u.path=="/callback" else{self?.respond(c,ok:false,message:"无效请求。");return}
                let items=u.queryItems ?? [],returned=items.first(where:{$0.name=="state"})?.value
                guard returned==state else{self?.respond(c,ok:false,message:"授权校验失败，请重新连接。");return}
                guard let code=items.first(where:{$0.name=="code"})?.value,!code.isEmpty else{
                    self?.respond(c,ok:false,message:"你尚未完成授权，请回到重新定义价值重试。");self?.finish(.failure(Failure("飞书授权已取消。")));return
                }
                self?.respond(c,ok:true,message:"授权已收到，请返回「重新定义价值」查看连接结果。");self?.finish(.success(code))
            }
        }
    }
    func respond(_ c:NWConnection,ok:Bool,message:String){
        let body="<!doctype html><meta charset='utf-8'><title>重新定义价值</title><body style='font-family:system-ui;padding:80px;background:#0d0a15;color:#cba2ff'><h1>重新定义价值</h1><p>\(message)</p></body>"
        let data=Data(body.utf8),header="HTTP/1.1 \(ok ? "200 OK":"400 Bad Request")\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(data.count)\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\n\r\n"
        c.send(content:Data(header.utf8)+data,completion:.contentProcessed{_ in c.cancel()})
    }
}

final class DragHandle:NSView {
    override func mouseDown(with event:NSEvent){if let w=window,w.isMovable{w.performDrag(with:event)}}
}

@MainActor final class AppController:NSObject,NSApplicationDelegate,WKScriptMessageHandler,WKNavigationDelegate,NSWindowDelegate,UNUserNotificationCenterDelegate {
    var window:NSWindow!;var web:WKWebView!;var dragHandle:DragHandle!;var status:NSStatusItem!;let feishu=FeishuClient(),callback=CallbackServer();var syncBusy=false;var cliAuthBusy=false;var cliAuthGeneration=0
    var cliEnabled:Bool {get{UserDefaults.standard.object(forKey:"CLIEnabled") as? Bool ?? true}set{UserDefaults.standard.set(newValue,forKey:"CLIEnabled")}}
    let storeURL:URL
    init(storeURL:URL?=nil){self.storeURL=storeURL ?? FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask).first!.appendingPathComponent("在场",isDirectory:true);super.init()}
    var state:[String:Any]=[:],cache:[String:Any]=[:]
    lazy var financeVault=FinanceVault(root:storeURL)
    var financeStorageReady=false,financePromptBusy=false,financeWarning=""
    var financeObservers:[NSObjectProtocol]=[]
    func read(_ name:String)->[String:Any]{guard let d=try? Data(contentsOf:storeURL.appendingPathComponent(name)),let j=try? JSONSerialization.jsonObject(with:d) as? [String:Any] else{return [:]};return j}
    func write(_ name:String,_ object:[String:Any])throws {
        try FileManager.default.createDirectory(at:storeURL,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        let path=storeURL.appendingPathComponent(name);try JSONSerialization.data(withJSONObject:object).write(to:path,options:.atomic);try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:path.path)
    }
    func saveState(_ object:[String:Any])throws {
        guard financeStorageReady else{throw Failure("财务迁移尚未完成，原数据已保留，请先处理财务存储错误。")}
        if financeVault.isUnlocked,let list=object["finance"] as? [[String:Any]]{try financeVault.save(list)}
        var publicState=object;publicState.removeValue(forKey:"finance")
        try write("state.json",publicState);state=publicState
        do{try ReflectionArchive(root:storeURL).save(object["thoughts"] as? [String:Any] ?? [:])}catch{throw Failure("主记录已保存，但独立复盘归档失败。请检查本机剩余空间。") }
    }
    func financeInfo()->[String:Any]{["configured":financeVault.configured,"locked":!financeVault.isUnlocked,"available":financeStorageReady]}
    func publicState()->[String:Any]{var safe=state;safe.removeValue(forKey:"finance");return safe}
    func exportSnapshot(includeFinance:Bool=true)throws->[String:Any]{let included=includeFinance && financeVault.isUnlocked;var exported=publicState();exported["exportedAt"]=ISO8601DateFormatter().string(from:Date());exported["financeIncluded"]=included;exported["finance"]=included ? try financeVault.records():[];return exported}
    func lockFinance(){financeVault.lock();event("financeLocked",financeInfo())}
    @objc func sleepFinance(){lockFinance()}
    func promptFinance(change:Bool=false)throws->Bool {
        guard financeStorageReady else{throw Failure(financeWarning.isEmpty ? "财务保险箱不可用。":financeWarning)}
        guard !financePromptBusy else{throw Failure("财务密码窗口已经打开。")}
        if !change && financeVault.isUnlocked{return true}
        financePromptBusy=true;defer{financePromptBusy=false}
        let setup = !financeVault.configured
        let alert=NSAlert();alert.messageText=setup ? "设置财务密码":change ? "修改财务密码":"解锁财务"
        alert.informativeText=setup ? "设置后加密保存已有账目。密码至少 6 位，请妥善记住；忘记密码将无法解锁。":change ? "先验证原密码，再设置新密码。":"输入财务密码后查看账目和汇总。"
        alert.addButton(withTitle:setup ? "设置并解锁":change ? "保存新密码":"解锁");alert.addButton(withTitle:"取消")
        let count=setup ? 2:change ? 3:1,view=NSView(frame:NSRect(x:0,y:0,width:280,height:CGFloat(count)*42))
        var fields:[NSSecureTextField]=[]
        let hints=setup ? ["新密码（至少 6 位）","再次输入新密码"]:change ? ["原密码","新密码（至少 6 位）","再次输入新密码"]:["财务密码"]
        for i in 0..<count{let field=NSSecureTextField(frame:NSRect(x:0,y:CGFloat(count-1-i)*42,width:280,height:30));field.placeholderString=hints[i];field.setAccessibilityLabel(hints[i]);view.addSubview(field);fields.append(field)}
        alert.accessoryView=view;showWindow();alert.window.initialFirstResponder=fields[0]
        guard alert.runModal() == .alertFirstButtonReturn else{return false}
        defer{for field in fields{field.stringValue=""}}
        if setup{guard fields[0].stringValue==fields[1].stringValue else{throw Failure("两次新密码不一致，请重新设置。")};try financeVault.setPassword(fields[0].stringValue)}
        else if change{try financeVault.unlock(fields[0].stringValue);guard fields[1].stringValue==fields[2].stringValue else{financeVault.lock();throw Failure("两次新密码不一致，请重新设置。")};do{try financeVault.setPassword(fields[1].stringValue)}catch{financeVault.lock();throw error}}
        else{try financeVault.unlock(fields[0].stringValue)}
        return true
    }
    func refreshCLI()async->[String:Any] {
        guard let cli=LarkCLI.locate() else{return ["installed":false,"ready":false]}
        let info=await cli.status()
        if info["ready"] as? Bool == true,cliEnabled{feishu.cli=cli}else{feishu.cli=nil}
        return info
    }
    func applicationDidFinishLaunching(_ notification:Notification){
        NSApp.setActivationPolicy(.accessory);state=read("state.json");cache=read("calendar-cache.json")
        do{try financeVault.prepare(legacy:state["finance"] as? [[String:Any]] ?? []);var clean=state;clean.removeValue(forKey:"finance");try write("state.json",clean);state=clean;financeStorageReady=true}catch{financeWarning=error.localizedDescription}
        financeObservers.append(NSWorkspace.shared.notificationCenter.addObserver(forName:NSWorkspace.willSleepNotification,object:nil,queue:.main){[weak self] _ in Task{@MainActor in self?.lockFinance()}})
        DistributedNotificationCenter.default().addObserver(self,selector:#selector(sleepFinance),name:NSNotification.Name("com.apple.screenIsLocked"),object:nil)
        UNUserNotificationCenter.current().delegate=self
        let config=WKWebViewConfiguration();config.userContentController.add(self,name:"native")
        web=WKWebView(frame:.zero,configuration:config);web.navigationDelegate=self;web.setValue(false,forKey:"drawsBackground")
        window=NSWindow(contentRect:NSRect(x:0,y:0,width:402,height:820),styleMask:[.titled,.closable,.miniaturizable,.resizable,.fullSizeContentView],backing:.buffered,defer:false)
        window.title="重新定义价值";window.titleVisibility = .hidden;window.titlebarAppearsTransparent=true;window.backgroundColor = NSColor(calibratedRed:13/255,green:10/255,blue:21/255,alpha:1);window.appearance=NSAppearance(named:.darkAqua);window.isOpaque=true;window.hasShadow=true;window.isReleasedWhenClosed=false;window.delegate=self
        window.minSize=NSSize(width:340,height:620);window.maxSize=NSSize(width:560,height:1300)
        let root=NSView(frame:NSRect(x:0,y:0,width:402,height:820));web.frame=root.bounds;web.autoresizingMask=[.width,.height];root.addSubview(web)
        dragHandle=DragHandle(frame:NSRect(x:0,y:768,width:284,height:52));dragHandle.autoresizingMask=[.width,.minYMargin];root.addSubview(dragHandle);window.contentView=root
        for button in [NSWindow.ButtonType.closeButton,.miniaturizeButton,.zoomButton]{window.standardWindowButton(button)?.isHidden=true}
        window.setFrameAutosaveName("ZaichangWindow")
        if !window.setFrameUsingName("ZaichangWindow"),let screen=NSScreen.main?.visibleFrame {window.setFrameOrigin(NSPoint(x:screen.maxX-440,y:screen.maxY-850))}
        window.collectionBehavior=[.canJoinAllSpaces,.stationary,.ignoresCycle,.fullScreenAuxiliary]
        configureWindow(mode:state["mode"] as? String ?? "desktop",locked:state["locked"] as? Bool ?? false)
        status=NSStatusBar.system.statusItem(withLength:NSStatusItem.squareLength)
        status.button?.image=NSImage(systemSymbolName:"calendar.badge.clock",accessibilityDescription:"重新定义价值")
        let menu=NSMenu();menu.addItem(withTitle:"显示重新定义价值",action:#selector(showWindow),keyEquivalent:"");menu.addItem(withTitle:"调整便签位置",action:#selector(repositionWindow),keyEquivalent:"");menu.addItem(withTitle:"收起",action:#selector(hideWindow),keyEquivalent:"");menu.addItem(.separator());menu.addItem(withTitle:"退出重新定义价值",action:#selector(quit),keyEquivalent:"q");for item in menu.items{item.target=self};status.menu=menu
        let mainMenu=NSMenu(),appMenu=NSMenu(),appItem=NSMenuItem();appItem.submenu=appMenu;appMenu.addItem(withTitle:"退出重新定义价值",action:#selector(quit),keyEquivalent:"q");appMenu.items.first?.target=self;mainMenu.addItem(appItem)
        let edit=NSMenu(title:"编辑"),editItem=NSMenuItem(title:"编辑",action:nil,keyEquivalent:"");editItem.submenu=edit
        for (name,selector,key) in [("撤销","undo:","z"),("剪切","cut:","x"),("复制","copy:","c"),("粘贴","paste:","v"),("全选","selectAll:","a")]{edit.addItem(withTitle:name,action:NSSelectorFromString(selector),keyEquivalent:key)};mainMenu.addItem(editItem);NSApp.mainMenu=mainMenu
        guard let root=Bundle.main.resourceURL?.appendingPathComponent("web"),FileManager.default.fileExists(atPath:root.appendingPathComponent("index.html").path) else{NSApp.terminate(nil);return}
        web.loadFileURL(root.appendingPathComponent("index.html"),allowingReadAccessTo:root);window.orderFrontRegardless()
    }
    func configureWindow(mode:String,locked:Bool){window.isMovable = !locked;window.isMovableByWindowBackground = !locked;dragHandle?.isHidden=locked
        switch mode{case "top":window.level = .floating;case "normal":window.level = .normal;default:window.level=locked ? NSWindow.Level(rawValue:NSWindow.Level.normal.rawValue-1) : .normal}
        if mode == "desktop" && !locked{window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)}
    }
    @objc func showWindow(){window.orderFrontRegardless();NSApp.activate(ignoringOtherApps:true)}
    @objc func repositionWindow(){web.evaluateJavaScript("state.locked=false; applyWindow()",completionHandler:nil)}
    @objc func hideWindow(){web.evaluateJavaScript("void window.lockFinancialView()",completionHandler:nil);window.orderOut(nil)}
    @objc func quit(){web.evaluateJavaScript("JSON.stringify(state)") {[weak self] result,_ in
        if let text=result as? String,let data=text.data(using:.utf8),let object=try? JSONSerialization.jsonObject(with:data) as? [String:Any]{try? self?.saveState(object)}
        self?.window.orderOut(nil);NSApp.terminate(nil)
    }}
    func windowShouldClose(_ sender:NSWindow)->Bool {hideWindow();return false}
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool {false}
    func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows flag:Bool)->Bool {showWindow();return true}
    func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage){
        guard message.frameInfo.isMainFrame,message.frameInfo.request.url?.isFileURL==true,let body=message.body as? [String:Any],let id=body["id"] as? Int,let action=body["action"] as? String else{return}
        let p=body["payload"] as? [String:Any] ?? [:]
        Task{@MainActor in do{let result=try await handle(action,p);reply(id,result,nil)}catch{reply(id,nil,error.localizedDescription)}}
    }
    func reply(_ id:Int,_ value:Any?,_ error:String?){
        guard let d=try? JSONSerialization.data(withJSONObject:[id,value ?? NSNull(),error as Any? ?? NSNull()]),let json=String(data:d,encoding:.utf8) else{return}
        web.evaluateJavaScript("window.nativeResponse(...\(json))",completionHandler:nil)
    }
    func event(_ name:String,_ data:Any){guard let d=try? JSONSerialization.data(withJSONObject:[name,data]),let json=String(data:d,encoding:.utf8) else{return};web.evaluateJavaScript("window.nativeEvent(...\(json))",completionHandler:nil)}
    func handle(_ action:String,_ p:[String:Any])async throws->Any {
        switch action {
        case "bootstrap":
            let cliInfo=await refreshCLI();var archiveWarning=""
            do{try ReflectionArchive(root:storeURL).save(state["thoughts"] as? [String:Any] ?? [:])}catch{archiveWarning="复盘独立归档暂时失败，主记录已保留。请检查本机存储空间。"}
            let safeState=publicState()
            return ["state":safeState,"finance":financeInfo(),"financeWarning":financeWarning,"cache":cache,"connected":feishu.connected,"source":feishu.cli != nil ? "cli":"api","cli":cliInfo,"archiveWarning":archiveWarning,"appId":feishu.credential?.appId ?? "","firstRun":state.isEmpty]
        case "financeUnlock":
            guard try promptFinance() else{return ["unlocked":false,"info":financeInfo()]}
            return ["unlocked":true,"records":try financeVault.records(),"info":financeInfo()]
        case "financeLock":lockFinance();return financeInfo()
        case "financePassword":
            let changed=try promptFinance(change:true);lockFinance();return ["changed":changed,"info":financeInfo()]
        case "cliStatus":
            let info=await refreshCLI();return ["connected":feishu.connected,"source":feishu.cli != nil ? "cli":"api","cli":info]
        case "cliConnect":
            guard !cliAuthBusy,!syncBusy else{throw Failure("正在连接或同步，请稍后重试。")}
            guard let cli=LarkCLI.locate() else{throw Failure("未检测到飞书官方 CLI，请先安装后重试。")}
            cliEnabled=true;let info=await refreshCLI()
            if info["ready"] as? Bool == true{event("authorized",["source":"cli"]);return ["ready":true]}
            let auth=try await cli.run(["auth","login","--scope","calendar:calendar:readonly offline_access","--no-wait","--json"])
            guard let link=auth["verification_url"] as? String,let url=URL(string:link),url.scheme=="https",url.host=="accounts.feishu.cn",let code=auth["device_code"] as? String else{throw Failure("飞书 CLI 未返回有效授权链接，请检查应用配置。")}
            guard NSWorkspace.shared.open(url) else{throw Failure("无法打开飞书授权页面。")}
            cliAuthBusy=true;cliAuthGeneration += 1;let generation=cliAuthGeneration
            Task{@MainActor in
                defer{self.cliAuthBusy=false}
                do{
                    _ = try await cli.run(["auth","login","--device-code",code,"--json"],timeout:620)
                    guard self.cliAuthGeneration==generation,self.cliEnabled else{return}
                    let status=await self.refreshCLI();guard status["ready"] as? Bool == true else{throw Failure("授权尚未完成，请重新连接。")}
                    self.event("authorized",["source":"cli"]);self.showWindow()
                }catch{if self.cliAuthGeneration==generation{self.event("authError",error.localizedDescription)}}
            }
            return ["ready":false]
        case "openArchive":
            try ReflectionArchive(root:storeURL).save(state["thoughts"] as? [String:Any] ?? [:]);NSWorkspace.shared.open(storeURL.appendingPathComponent("reflections",isDirectory:true));return true
        case "saveState":guard let s=p["state"] as? [String:Any] else{throw Failure("记录格式错误。")};try saveState(s);return true
        case "saveCache":guard let c=p["cache"] as? [String:Any] else{throw Failure("日历缓存格式错误。")};try write("calendar-cache.json",c);cache=c;return true
        case "window":configureWindow(mode:p["mode"] as? String ?? "desktop",locked:p["locked"] as? Bool ?? false);return true
        case "drag":if window.isMovable,let e=NSApp.currentEvent,e.type == .leftMouseDown{window.performDrag(with:e)};return true
        case "hide":hideWindow();return true
        case "copy":NSPasteboard.general.clearContents();NSPasteboard.general.setString(p["text"] as? String ?? "",forType:.string);return true
        case "openURL":guard let s=p["url"] as? String,let u=URL(string:s),["https","http"].contains(u.scheme?.lowercased() ?? "") else{throw Failure("链接格式错误。")};NSWorkspace.shared.open(u);return true
        case "authorize":
            guard !syncBusy else{throw Failure("正在同步，请稍后重新连接。")}
            cliEnabled=false;feishu.cli=nil
            let id=p["appId"] as? String ?? "",secret=(p["secret"] as? String).flatMap{$0.isEmpty ? nil:$0} ?? (feishu.credential?.appId==id ? feishu.credential?.secret:nil) ?? ""
            guard id.hasPrefix("cli_"),!secret.isEmpty else{throw Failure("请填写自建应用的 App ID 和 App Secret。")}
            let state=UUID().uuidString+UUID().uuidString,verifier=UUID().uuidString+UUID().uuidString
            let challenge=Data(SHA256.hash(data:Data(verifier.utf8))).base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"")
            try callback.start(state:state){[weak self] result in guard let self=self else{return};Task{@MainActor in
                do{let code=try result.get();try await self.feishu.exchange(code:code,verifier:verifier,appId:id,secret:secret);self.event("authorized",true);self.showWindow()}catch{self.event("authError",error.localizedDescription)}
            }}
            var u=URLComponents(string:"https://accounts.feishu.cn/open-apis/authen/v1/authorize")!;u.queryItems=["client_id":id,"response_type":"code","redirect_uri":CallbackServer.redirect,"scope":"calendar:calendar:readonly offline_access","state":state,"code_challenge":challenge,"code_challenge_method":"S256"].map{URLQueryItem(name:$0.key,value:$0.value)}
            guard let url=u.url,NSWorkspace.shared.open(url) else{callback.stop();throw Failure("无法打开授权浏览器，请检查默认浏览器。")};return true
        case "disconnect":cliEnabled=false;cliAuthGeneration += 1;callback.stop();feishu.disconnect();cache=[:];try write("calendar-cache.json",cache);return true
        case "sync":guard !syncBusy else{throw Failure("日程正在同步。")};syncBusy=true;defer{syncBusy=false};return try await feishu.sync(start:(p["start"] as? NSNumber)?.intValue ?? 0,end:(p["end"] as? NSNumber)?.intValue ?? 0)
        case "requestNotifications":let allowed=try await UNUserNotificationCenter.current().requestAuthorization(options:[.alert,.sound]);return ["allowed":allowed]
        case "notifications":return try await schedule(p)
        case "export":
            let panel=NSSavePanel();panel.nameFieldStringValue="重新定义价值记录-"+ISO8601DateFormatter().string(from:Date()).prefix(10)+".json";panel.allowedContentTypes=[.json];panel.canCreateDirectories=true
            let exported=try exportSnapshot(includeFinance:p["includeFinance"] as? Bool == true);let financeIncluded=exported["financeIncluded"] as? Bool == true
            panel.title=financeIncluded ? "导出记录（含已解锁财务）":"导出其他记录（财务已锁定）"
            NSApp.activate(ignoringOtherApps:true);if panel.runModal() == .OK,let url=panel.url{try JSONSerialization.data(withJSONObject:exported,options:.prettyPrinted).write(to:url,options:.atomic);try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:url.path);return ["saved":true,"financeIncluded":financeIncluded]};return ["saved":false]
        default:throw Failure("暂不支持这个操作。")
        }
    }
    func schedule(_ p:[String:Any])async throws->[String:Any] {
        let center=UNUserNotificationCenter.current(),settings=await center.notificationSettings()
        center.removeAllPendingNotificationRequests()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else{return ["allowed":false]}
        if p["enabled"] as? Bool == true {
            let t=(p["time"] as? String ?? "21:00").split(separator:":").compactMap{Int($0)}
            if t.count==2 {
                var d=DateComponents();d.hour=t[0];d.minute=t[1]
                let c=UNMutableNotificationContent();c.title="每日复盘";c.body=p["prompt"] as? String ?? "今天，什么值得记住？";c.sound = .default
                try await center.add(UNNotificationRequest(identifier:"reflection",content:c,trigger:UNCalendarNotificationTrigger(dateMatching:d,repeats:true)))
            }
        }
        if p["eventsEnabled"] as? Bool == true {
            let list=(p["events"] as? [[String:Any]] ?? []).sorted{($0["start"] as? Double ?? 0)<($1["start"] as? Double ?? 0)}
            for e in list.prefix(50) {
                guard let start=e["start"] as? Double,let id=e["id"] as? String,start-600>Date().timeIntervalSince1970+2 else{continue}
                let c=UNMutableNotificationContent();c.title=e["title"] as? String ?? "日程提醒";c.body="10 分钟后开始";c.sound = .default
                let d=Calendar.current.dateComponents([.year,.month,.day,.hour,.minute,.second],from:Date(timeIntervalSince1970:start-600))
                try await center.add(UNNotificationRequest(identifier:"event-"+id,content:c,trigger:UNCalendarNotificationTrigger(dateMatching:d,repeats:false)))
            }
        }
        return ["allowed":true]
    }
    nonisolated func userNotificationCenter(_ center:UNUserNotificationCenter,willPresent notification:UNNotification,withCompletionHandler completionHandler:@escaping(UNNotificationPresentationOptions)->Void){completionHandler([.banner,.sound])}
    nonisolated func userNotificationCenter(_ center:UNUserNotificationCenter,didReceive response:UNNotificationResponse,withCompletionHandler completionHandler:@escaping()->Void){Task{@MainActor in self.showWindow();completionHandler()}}
    func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){
        guard let url=navigationAction.request.url else{decisionHandler(.cancel);return}
        if url.isFileURL{decisionHandler(.allow)}else{decisionHandler(.cancel);if url.scheme=="https"{NSWorkspace.shared.open(url)}}
    }
}

#if !TESTING
@main struct RedefineMain {
    @MainActor static func main(){
        let application=NSApplication.shared
        let controller=AppController()
        application.delegate=controller
        withExtendedLifetime(controller){application.run()}
    }
}
#endif
