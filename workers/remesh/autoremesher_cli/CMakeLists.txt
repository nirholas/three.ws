# Builds autoremesher-cli: our headless main.cpp against the Qt-free core of
# AutoRemesher (https://github.com/huxingyi/autoremesher, MIT). Configure with
# -DAUTOREMESHER_SRC=<checkout of the upstream repo at the pinned commit>.
# Eigen, the isotropic remesher and meshoptimizer come from upstream's
# thirdparty/ (MPL-2.0 / MIT / MIT); TBB (Apache-2.0) is the system package.
cmake_minimum_required(VERSION 3.16)
project(autoremesher_cli CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

if(NOT AUTOREMESHER_SRC)
  message(FATAL_ERROR "set -DAUTOREMESHER_SRC to an autoremesher checkout")
endif()

find_package(TBB REQUIRED)

set(AR ${AUTOREMESHER_SRC})
add_executable(autoremesher-cli
  main.cpp
  ${AR}/src/AutoRemesher/autoremesher.cpp
  ${AR}/src/AutoRemesher/isotropicremesher.cpp
  ${AR}/src/AutoRemesher/parameterizer.cpp
  ${AR}/src/AutoRemesher/surfacemesh.cpp
  ${AR}/src/AutoRemesher/singularitysimplifier.cpp
  ${AR}/src/AutoRemesher/constrainedleastsquares.cpp
  ${AR}/src/AutoRemesher/mixedintegerleastsquares.cpp
  ${AR}/src/AutoRemesher/framefield.cpp
  ${AR}/src/AutoRemesher/quadparameterizer.cpp
  ${AR}/src/AutoRemesher/quadextractor.cpp
  ${AR}/src/AutoRemesher/positionkey.cpp
  ${AR}/src/AutoRemesher/meshseparator.cpp
  ${AR}/thirdparty/isotropicremesher/isotropicremesher.cpp
  ${AR}/thirdparty/isotropicremesher/isotropichalfedgemesh.cpp
  ${AR}/thirdparty/isotropicremesher/axisalignedboundingboxtree.cpp
  ${AR}/thirdparty/meshoptimizer/src/simplifier.cpp
  ${AR}/thirdparty/meshoptimizer/src/indexgenerator.cpp
)
target_include_directories(autoremesher-cli PRIVATE
  ${AR}/include
  ${AR}/src
  ${AR}/thirdparty/eigen
  ${AR}/thirdparty/isotropicremesher
  ${AR}/thirdparty/meshoptimizer/src
)
target_compile_definitions(autoremesher-cli PRIVATE NDEBUG _USE_MATH_DEFINES)
target_compile_options(autoremesher-cli PRIVATE -O3 -funroll-loops)
target_link_libraries(autoremesher-cli PRIVATE TBB::tbb)
install(TARGETS autoremesher-cli RUNTIME DESTINATION bin)
