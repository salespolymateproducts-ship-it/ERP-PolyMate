package com.backend.erp.config;

import java.nio.charset.StandardCharsets;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.util.StreamUtils;

import com.backend.erp.auth.AuthService;

/** สร้างตาราง (idempotent) และ admin เริ่มต้น ก่อนเปิดรับ request */
@Component
public class SchemaInit implements SmartInitializingSingleton {
	private static final Logger log = LoggerFactory.getLogger(SchemaInit.class);
	private final JdbcTemplate jdbc;
	private final AuthService auth;
	private final String initialPassword;

	public SchemaInit(JdbcTemplate jdbc, AuthService auth, @Value("${erp.admin.initial-password:}") String initialPassword) {
		this.jdbc = jdbc;
		this.auth = auth;
		this.initialPassword = initialPassword;
	}

	@Override
	public void afterSingletonsInstantiated() {
		try {
			String sql = StreamUtils.copyToString(new ClassPathResource("schema.sql").getInputStream(), StandardCharsets.UTF_8);
			jdbc.execute(sql);
		} catch (java.io.IOException e) {
			throw new IllegalStateException("อ่าน schema.sql ไม่ได้", e);
		}
		Integer n = jdbc.queryForObject("select count(*) from erp_users", Integer.class);
		if (n != null && n == 0) {
			boolean generated = initialPassword == null || initialPassword.isBlank();
			String pw = generated ? AuthService.randomPassword() : initialPassword;
			AuthService.checkPasswordPolicy(pw);
			jdbc.update("insert into erp_users(id,username,full_name,role,dept,password_hash,must_change) values ('USR-admin','admin','ผู้ดูแลระบบ','admin','IT',?,true)", auth.hash(pw));
			if (generated) log.warn("สร้างผู้ใช้ admin ครั้งแรก — รหัสผ่านชั่วคราว (แสดงครั้งเดียว): {}", pw);
			else log.warn("สร้างผู้ใช้ admin ครั้งแรกด้วยรหัสผ่านจาก ADMIN_INITIAL_PASSWORD (ต้องเปลี่ยนเมื่อ login ครั้งแรก)");
		}
		jdbc.update("delete from erp_sessions where expires_at < now()");
	}
}
