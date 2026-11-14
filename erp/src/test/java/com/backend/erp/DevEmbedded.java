package com.backend.erp;

import java.nio.file.Path;

import org.springframework.boot.SpringApplication;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;

/**
 * รัน Backend พร้อม PostgreSQL ในเครื่อง (ไม่ต้องมี EC2/Docker) สำหรับพัฒนา/ทดลองเท่านั้น
 * ข้อมูลเก็บที่ erp/build/dev-pgdata  —  รัน: npm run backend:local
 */
public class DevEmbedded {
	public static void main(String[] args) throws Exception {
		EmbeddedPostgres pg = EmbeddedPostgres.builder()
			.setPort(54329)
			.setDataDirectory(Path.of("build", "dev-pgdata"))
			.setCleanDataDirectory(false)
			.start();
		Runtime.getRuntime().addShutdownHook(new Thread(() -> { try { pg.close(); } catch (Exception ignored) { } }));
		String pw = System.getenv("ADMIN_INITIAL_PASSWORD");
		SpringApplication.run(ErpApplication.class,
			"--spring.datasource.url=" + pg.getJdbcUrl("postgres", "postgres"),
			"--spring.datasource.username=postgres",
			"--spring.datasource.password=postgres",
			"--erp.admin.initial-password=" + (pw == null || pw.isBlank() ? "Admin-12345" : pw));
	}
}
