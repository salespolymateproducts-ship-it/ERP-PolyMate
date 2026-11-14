package com.backend.erp.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import com.backend.erp.auth.AuthInterceptor;

@Configuration
public class WebConfig implements WebMvcConfigurer {
	private final AuthInterceptor auth;
	private final String[] origins;

	public WebConfig(AuthInterceptor auth, @Value("${erp.cors.allowed-origins}") String origins) {
		this.auth = auth;
		this.origins = origins.split("\\s*,\\s*");
	}

	@Override
	public void addInterceptors(InterceptorRegistry r) {
		r.addInterceptor(auth).addPathPatterns("/api/v1/**");
	}

	@Override
	public void addCorsMappings(CorsRegistry r) {
		r.addMapping("/api/v1/**")
			.allowedOrigins(origins)
			.allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
			.allowedHeaders("Authorization", "Content-Type")
			.maxAge(3600);
	}
}
