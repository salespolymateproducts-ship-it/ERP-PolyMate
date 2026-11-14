package com.backend.erp;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ErpApplication {

	public static void main(String[] args) {
		try {
			SpringApplication.run(ErpApplication.class, args);
		} catch (Throwable e) {
			// Spring stack traces are huge: print the real root cause in plain English
			Throwable root = e;
			while (root.getCause() != null && root.getCause() != root) root = root.getCause();
			System.err.println();
			System.err.println("=================== STARTUP FAILED ===================");
			System.err.println("Root cause: " + root.getClass().getName() + ": " + root.getMessage());
			String m = String.valueOf(root.getMessage()).toLowerCase();
			if (m.contains("refused") || m.contains("timed out") || m.contains("unreachable") || m.contains("unknownhost")) {
				System.err.println("-> Cannot reach the DB host/port: check DB_URL, SSH tunnel or Security Group (port 5432)");
			} else if (m.contains("password authentication") || m.contains("authentication failed")) {
				System.err.println("-> Wrong DB_USERNAME or DB_PASSWORD");
			} else if (m.contains("does not exist")) {
				System.err.println("-> Database does not exist: check the DB name in DB_URL");
			}
			System.err.println("DB_URL in use: " + System.getenv().getOrDefault("DB_URL", "(not set -> defaults to jdbc:postgresql://localhost:5432/erp)"));
			System.err.println("=========================================================");
			throw e;
		}
	}

}
