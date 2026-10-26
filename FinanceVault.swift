import Foundation
import CryptoKit
import CommonCrypto
import Security

/// Financial data never belongs to the ordinary state file or a locked web view.
final class FinanceVault {
    private struct Envelope:Codable { var version:Int=1;var mode:String;var salt:Data;var rounds:Int;var box:Data }
    private let root:URL
    private let readPending:()->Data?
    private let writePending:(Data?)throws->Void
    private var envelope:Envelope?
    private var sessionKey:SymmetricKey?
    private var rows:[[String:Any]]?
    private var failures=0
    private var retryAfter=Date.distantPast
    var isUnlocked:Bool {sessionKey != nil && rows != nil}
    var configured:Bool {envelope?.mode == "password"}
    init(root:URL,readPending:@escaping()->Data?={FinancePendingKey.read()},writePending:@escaping(Data?)throws->Void={try FinancePendingKey.write($0)}) {
        self.root=root;self.readPending=readPending;self.writePending=writePending
    }
    private var file:URL {root.appendingPathComponent("finance-vault.json")}
    private static func random(_ length:Int)throws->Data {
        var bytes=Data(count:length)
        guard bytes.withUnsafeMutableBytes({SecRandomCopyBytes(kSecRandomDefault,length,$0.baseAddress!)}) == errSecSuccess else{throw Failure("无法生成财务加密密钥。")};return bytes
    }
    private static func derive(_ password:String,_ salt:Data,_ rounds:Int)throws->SymmetricKey {
        guard salt.count==32,(100_000...1_000_000).contains(rounds) else{throw Failure("财务加密文件参数无效。")}
        let input=Data(password.utf8);var output=Data(count:32)
        let status=output.withUnsafeMutableBytes{out in salt.withUnsafeBytes{s in input.withUnsafeBytes{p in
            CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2),p.baseAddress!.assumingMemoryBound(to:CChar.self),input.count,s.baseAddress!.assumingMemoryBound(to:UInt8.self),salt.count,CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),UInt32(rounds),out.baseAddress!.assumingMemoryBound(to:UInt8.self),32)
        }}}
        guard status==kCCSuccess else{throw Failure("无法处理财务密码。")};return SymmetricKey(data:output)
    }
    private func write(_ value:Envelope)throws {
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        try JSONEncoder().encode(value).write(to:file,options:.atomic)
        try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path);envelope=value
    }
    private func decoded(_ e:Envelope,_ key:SymmetricKey)throws->[[String:Any]] {
        let data=try AES.GCM.open(AES.GCM.SealedBox(combined:e.box),using:key)
        guard let list=try JSONSerialization.jsonObject(with:data) as? [[String:Any]] else{throw Failure("财务记录格式无效。")};return list
    }
    private func sealed(_ list:[[String:Any]],_ key:SymmetricKey)throws->Data {
        guard let combined=try AES.GCM.seal(JSONSerialization.data(withJSONObject:list,options:[.sortedKeys]),using:key).combined else{throw Failure("无法加密财务记录。")};return combined
    }
    func prepare(legacy:[[String:Any]])throws {
        if FileManager.default.fileExists(atPath:file.path){
            let e=try JSONDecoder().decode(Envelope.self,from:Data(contentsOf:file))
            guard e.version==1,["pending","password"].contains(e.mode),e.box.count>=28 else{throw Failure("财务保险箱格式无效，原记录未更改。")}
            if e.mode=="pending"{guard let key=readPending(),key.count==32 else{throw Failure("本机财务迁移密钥不可用，请保留数据并联系维护者。")};_ = try decoded(e,SymmetricKey(data:key))}
            else if !legacy.isEmpty{throw Failure("发现尚未迁移的旧财务副本，原记录已保留；请先核对财务备份。")}
            envelope=e;return
        }
        let raw=try Self.random(32),key=SymmetricKey(data:raw)
        try writePending(raw)
        let encrypted=Envelope(mode:"pending",salt:Data(),rounds:0,box:try sealed(legacy,key))
        try write(encrypted)
        let recovered=try decoded(encrypted,key)
        guard try JSONSerialization.data(withJSONObject:legacy,options:.sortedKeys)==JSONSerialization.data(withJSONObject:recovered,options:.sortedKeys) else{throw Failure("财务迁移校验未通过，原记录未更改。")}
    }
    func setPassword(_ password:String)throws {
        guard password.count>=6,password.utf8.count<=512 else{throw Failure("密码至少 6 位，最长 512 个字节。")}
        guard let e=envelope else{throw Failure("财务保险箱尚未准备好。")}
        let list:[[String:Any]]
        if e.mode=="pending"{guard let raw=readPending(),raw.count==32 else{throw Failure("本机财务迁移密钥不可用。")};list=try decoded(e,SymmetricKey(data:raw))}
        else{list=try records()}
        let salt=try Self.random(32),rounds=310_000,key=try Self.derive(password,salt,rounds)
        try write(Envelope(mode:"password",salt:salt,rounds:rounds,box:sealed(list,key)))
        sessionKey=key;rows=list;failures=0;retryAfter = .distantPast
        try? writePending(nil)
    }
    func unlock(_ password:String)throws {
        guard Date()>=retryAfter else{throw Failure("密码尝试较多，请 30 秒后重试。")}
        guard let e=envelope,e.mode=="password" else{throw Failure("请先设置财务密码。")}
        guard !password.isEmpty,password.utf8.count<=512 else{throw Failure("请输入财务密码。")}
        let key=try Self.derive(password,e.salt,e.rounds)
        do{let list=try decoded(e,key);sessionKey=key;rows=list;failures=0}
        catch{failures += 1;if failures>=5{retryAfter=Date().addingTimeInterval(30);failures=0};throw Failure("密码不正确，或财务加密文件已损坏。")}
    }
    func records()throws->[[String:Any]] {guard isUnlocked,let rows=rows else{throw Failure("请先解锁财务。")};return rows}
    func save(_ list:[[String:Any]])throws {
        guard var e=envelope,let key=sessionKey,isUnlocked else{throw Failure("财务已锁定，未更改账目。")}
        let next=try JSONSerialization.data(withJSONObject:list,options:.sortedKeys)
        if let rows=rows,try JSONSerialization.data(withJSONObject:rows,options:.sortedKeys)==next{return}
        e.box=try sealed(list,key);try write(e);rows=list
    }
    func lock(){sessionKey=nil;rows=nil}
}

private enum FinancePendingKey {
    static let service="local.zaichang.desktop",account="finance-pending-key-v1"
    static var query:[String:Any]{[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:account]}
    static func read()->Data?{var q=query;q[kSecReturnData as String]=true;q[kSecMatchLimit as String]=kSecMatchLimitOne;var value:CFTypeRef?;guard SecItemCopyMatching(q as CFDictionary,&value)==errSecSuccess else{return nil};return value as? Data}
    static func write(_ data:Data?)throws {
        guard let data=data else{SecItemDelete(query as CFDictionary);return}
        let status=SecItemUpdate(query as CFDictionary,[kSecValueData as String:data] as CFDictionary)
        if status==errSecItemNotFound{var q=query;q[kSecValueData as String]=data;q[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;guard SecItemAdd(q as CFDictionary,nil)==errSecSuccess else{throw Failure("无法保存本机财务迁移密钥。")}}
        else if status != errSecSuccess{throw Failure("无法更新本机财务迁移密钥。")}
    }
}
