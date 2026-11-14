FROM eclipse-temurin:17-jdk AS build
WORKDIR /src
COPY . .
RUN chmod +x gradlew && ./gradlew bootJar -x test --no-daemon

FROM eclipse-temurin:17-jre
WORKDIR /app
RUN useradd -r -u 1001 erp
COPY --from=build /src/build/libs/*SNAPSHOT.jar app.jar
USER erp
EXPOSE 8080
ENTRYPOINT ["java", "-Duser.timezone=Asia/Bangkok", "-jar", "/app/app.jar"]
